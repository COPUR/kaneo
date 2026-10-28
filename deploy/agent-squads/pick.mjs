// Pull, don't push: a squad agent takes one card at a time (WIP limit 1),
// the most urgent one in Backlog that nothing unfinished blocks.

const rank = { urgent: 0, high: 1, medium: 2, low: 3, "no-priority": 4 };

// tasks: the board's Backlog tasks; blockers: task id -> relations from
// GET /task-relation/{id}. Returns the task to claim, or undefined.
export function pickNext(tasks, blockers) {
  const open = tasks.filter(
    (task) =>
      !task.userId &&
      !(blockers.get(task.id) ?? []).some(
        (r) =>
          r.relationType === "blocks" &&
          r.targetTaskId === task.id &&
          !r.sourceTask?.isCompleted,
      ),
  );
  return open.sort(
    (a, b) =>
      (rank[a.priority] ?? 4) - (rank[b.priority] ?? 4) ||
      (a.number ?? 0) - (b.number ?? 0),
  )[0];
}
