import { and, eq, inArray, or } from "drizzle-orm";
import type { Context, Next } from "hono";
import db from "../../database";
import { columnTable, taskTable } from "../../database/schema";
import { requireWorkspacePermission } from "../../utils/require-workspace-permission";

// A status a request wants a task to reach. `taskId` is set when an existing
// task moves; `projectId` is set when the target project is known up front.
export type StatusTarget = {
  taskId?: string;
  projectId?: string;
  status: string;
};

type TargetResolver = (
  c: Context,
  body: Record<string, unknown>,
) => StatusTarget[];

// Off by default so upstream behavior is unchanged. When on, moving a task into
// a final column needs task:close, so only roles granted it (for example a
// single CI/CD agent) can finish work.
export function finalColumnsRestricted() {
  return process.env.KANEO_RESTRICT_FINAL_COLUMNS === "true";
}

// Route middleware runs before the validators, so c.req.valid() is unavailable.
async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  const raw = (await c.req.json().catch(() => ({}))) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

async function closesTask(targets: StatusTarget[]) {
  const taskIds = targets.flatMap((target) =>
    target.taskId ? [target.taskId] : [],
  );
  const tasks = taskIds.length
    ? await db
        .select({
          id: taskTable.id,
          projectId: taskTable.projectId,
          status: taskTable.status,
        })
        .from(taskTable)
        .where(inArray(taskTable.id, taskIds))
    : [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const changes = targets.flatMap((target) => {
    const task = target.taskId ? taskById.get(target.taskId) : undefined;
    const projectId = target.projectId ?? task?.projectId;
    if (!projectId) return [];
    if (task?.projectId === projectId && task.status === target.status) {
      return [];
    }
    return [{ projectId, status: target.status }];
  });
  if (changes.length === 0) return false;

  const [finalColumn] = await db
    .select({ id: columnTable.id })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.isFinal, true),
        or(
          ...changes.map((change) =>
            and(
              eq(columnTable.projectId, change.projectId),
              eq(columnTable.slug, change.status),
            ),
          ),
        ),
      ),
    )
    .limit(1);
  return Boolean(finalColumn);
}

export function requireTaskClosePermission(resolve: TargetResolver) {
  return async (c: Context, next: Next) => {
    if (!finalColumnsRestricted()) return next();

    const targets = resolve(c, await readJsonBody(c)).filter(
      (target) => typeof target.status === "string" && target.status !== "",
    );
    if (targets.length > 0 && (await closesTask(targets))) {
      return requireWorkspacePermission({ task: ["close"] })(c, next);
    }
    return next();
  };
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

export const closeTargets = {
  create: (c: Context, body: Record<string, unknown>) => [
    { projectId: c.req.param("projectId"), status: text(body.status) },
  ],
  update: (c: Context, body: Record<string, unknown>) => [
    {
      taskId: c.req.param("id"),
      projectId: text(body.projectId) || undefined,
      status: text(body.status),
    },
  ],
  status: (c: Context, body: Record<string, unknown>) => [
    { taskId: c.req.param("id"), status: text(body.status) },
  ],
  move: (c: Context, body: Record<string, unknown>) => [
    {
      taskId: c.req.param("id"),
      projectId: text(body.destinationProjectId),
      status: text(body.destinationStatus),
    },
  ],
  reorder: (_c: Context, body: Record<string, unknown>) =>
    (Array.isArray(body.tasks) ? body.tasks : []).map((task) => ({
      taskId: text((task as Record<string, unknown>)?.id),
      projectId: text(body.projectId),
      status: text((task as Record<string, unknown>)?.status),
    })),
  bulk: (_c: Context, body: Record<string, unknown>) =>
    body.operation === "updateStatus" && Array.isArray(body.taskIds)
      ? body.taskIds.map((id) => ({
          taskId: text(id),
          status: text(body.value),
        }))
      : [],
  import: (c: Context, body: Record<string, unknown>) =>
    (Array.isArray(body.tasks) ? body.tasks : []).map((task) => ({
      projectId: c.req.param("projectId"),
      status: text((task as Record<string, unknown>)?.status),
    })),
} satisfies Record<string, TargetResolver>;
