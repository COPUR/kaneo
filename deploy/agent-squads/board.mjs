// A squad board as one agent sees it, through that agent's API key. Shared by
// kickoff.mjs, the squad runner and the CI/CD runner.

import { client } from "./lib.mjs";
import { pickNext } from "./pick.mjs";
import { tribe } from "./squads.mjs";

export async function openBoard(agent, boardKey) {
  const call = client({ apiKey: agent.apiKey });
  const { data: workspaces } = await call("GET", "/workspace");
  const workspace = workspaces.find((w) => w.slug === tribe.slug);
  if (!workspace) throw new Error(`${agent.name} cannot see ${tribe.name}`);
  const { data: projects } = await call(
    "GET",
    `/project?workspaceId=${workspace.id}`,
  );
  const project = projects.find((p) => p.slug === boardKey);
  if (!project) throw new Error(`${agent.name} cannot see board ${boardKey}`);

  let fields;
  const fieldId = async (name) => {
    fields ??= (await call("GET", `/custom-field/project/${project.id}`)).data;
    return fields.find((f) => f.name === name)?.id;
  };

  return {
    call,
    project,
    async tasksIn(slug) {
      const { data } = await call("GET", `/task/tasks/${project.id}?limit=100`);
      return data.data?.columns?.find((c) => c.slug === slug)?.tasks ?? [];
    },
    async task(id) {
      return (await call("GET", `/task/${id}`)).data;
    },
    async status(id) {
      return (await call("GET", `/task/${id}`)).data.status;
    },
    move: (id, status) => call("PUT", `/task/status/${id}`, { status }),
    comment: (id, content) => call("POST", `/comment/${id}`, { content }),
    async setField(taskId, name, value) {
      const id = await fieldId(name);
      if (id) {
        await call("PUT", "/custom-field/value", {
          taskId,
          fieldId: id,
          value,
        });
      }
    },
    async field(taskId, name) {
      const { data } = await call("GET", `/custom-field/task/${taskId}`);
      return data.find((v) => v.fieldName === name)?.value ?? null;
    },
  };
}

// WIP 1: the card in progress, or the most urgent unblocked Backlog card,
// which the agent then claims.
export async function currentOrClaim(board, agent) {
  const [current] = await board.tasksIn("in-progress");
  if (current) return { task: current, claimed: false };

  const backlog = await board.tasksIn("to-do");
  const blockers = new Map();
  for (const task of backlog) {
    const { data } = await board.call("GET", `/task-relation/${task.id}`);
    blockers.set(task.id, data ?? []);
  }
  const next = pickNext(backlog, blockers);
  if (!next) return { task: null, claimed: false };

  await board.move(next.id, "in-progress");
  await board.setField(next.id, "Agent status", "Claimed");
  await board.comment(
    next.id,
    `${agent.name} claimed this card. Work happens on a branch; the CI/CD agent merges and closes it.`,
  );
  return { task: next, claimed: true };
}
