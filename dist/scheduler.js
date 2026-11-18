// src/scheduler.ts
var LIVE_STATES = ["starting", "working", "idle", "waiting-for-input", "unknown"];
function isLive(run) {
  return run.endedAt === null && LIVE_STATES.includes(run.state);
}
function hasStopped(state) {
  return state === "done" || state === "exited" || state === "closed";
}
function verdictFor(status) {
  if (status === "DONE") return "done";
  if (status === "BLOCKED" || status === "REJECTED") return "blocked";
  return "needs-review";
}
function nextLaunches(runnable, runs, finishedInSession, maxParallel) {
  const live = runs.filter(isLive);
  const liveIds = new Set(live.map((run) => run.taskId));
  const room = Math.max(0, Math.floor(maxParallel) - live.length);
  if (room === 0) return [];
  return [...runnable].filter((task) => !liveIds.has(task.id) && !finishedInSession.has(task.id)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, room);
}
function sessionOver(runnable, runs, finishedInSession, maxParallel) {
  return !runs.some(isLive) && nextLaunches(runnable, runs, finishedInSession, maxParallel).length === 0;
}
export {
  LIVE_STATES,
  hasStopped,
  isLive,
  nextLaunches,
  sessionOver,
  verdictFor
};
