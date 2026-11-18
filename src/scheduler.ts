// Pure decisions of the auto-run session: which tasks to launch, when a run ended, and its verdict.
import type { RunRecord, RunVerdict, Task, TaskStatus } from "./types.js";

export const LIVE_STATES = ["starting", "working", "idle", "waiting-for-input", "unknown"] as const;

/** A run is live while its agent is in a live state and it has not been ended. */
export function isLive(run: RunRecord): boolean {
  return run.endedAt === null && (LIVE_STATES as readonly string[]).includes(run.state);
}

/** An agent stopped: "done" → the turn ended, "exited"/"closed" → the process/tab ended. */
export function hasStopped(state: RunRecord["state"]): boolean {
  return state === "done" || state === "exited" || state === "closed";
}

/** Decide the outcome from the plan status read AFTER the agent stopped. */
export function verdictFor(status: TaskStatus): RunVerdict {
  if (status === "DONE") return "done";
  if (status === "BLOCKED" || status === "REJECTED") return "blocked";
  return "needs-review";
}

/** Which tasks to launch now: runnable ones (TODO, deps DONE) without a live run, not already finished
 *  in this session, in id order, up to maxParallel − liveCount. */
export function nextLaunches(
  runnable: Task[],
  runs: RunRecord[],
  finishedInSession: Set<string>,
  maxParallel: number,
): Task[] {
  const live = runs.filter(isLive);
  const liveIds = new Set(live.map((run) => run.taskId));
  const room = Math.max(0, Math.floor(maxParallel) - live.length);
  if (room === 0) return [];
  return [...runnable]
    .filter((task) => !liveIds.has(task.id) && !finishedInSession.has(task.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, room);
}

/** The session is over when nothing is live and nextLaunches is empty. */
export function sessionOver(
  runnable: Task[],
  runs: RunRecord[],
  finishedInSession: Set<string>,
  maxParallel: number,
): boolean {
  return !runs.some(isLive) && nextLaunches(runnable, runs, finishedInSession, maxParallel).length === 0;
}
