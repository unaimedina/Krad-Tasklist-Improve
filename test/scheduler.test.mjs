import { test } from "node:test";
import assert from "node:assert/strict";
import { hasStopped, isLive, nextLaunches, sessionOver, verdictFor } from "../dist/scheduler.js";

function task(id) {
  return {
    id,
    slug: `t${id}`,
    file: `/r/plans/${id}-t.md`,
    title: `Task ${id}`,
    priority: null,
    effort: null,
    risk: null,
    dependsOn: [],
    status: "TODO",
    statusNote: null,
  };
}

function run(taskId, state = "working", endedAt = null) {
  return {
    taskId,
    root: "/r",
    terminal: Number(taskId),
    harness: "claude",
    mode: "here",
    cwd: "/r",
    worktree: null,
    branch: null,
    state,
    startedAt: "2026-11-18T00:00:00.000Z",
    endedAt,
  };
}

test("verdictFor maps plan statuses to verdicts", () => {
  assert.equal(verdictFor("DONE"), "done");
  assert.equal(verdictFor("BLOCKED"), "blocked");
  assert.equal(verdictFor("REJECTED"), "blocked");
  assert.equal(verdictFor("IN PROGRESS"), "needs-review");
  assert.equal(verdictFor("TODO"), "needs-review");
});

test("hasStopped and isLive", () => {
  for (const state of ["done", "exited", "closed"]) assert.equal(hasStopped(state), true, state);
  for (const state of ["starting", "working", "idle", "waiting-for-input", "unknown"]) {
    assert.equal(hasStopped(state), false, state);
    assert.equal(isLive(run("001", state)), true, state);
  }
  assert.equal(isLive(run("001", "working", "2026-11-18T01:00:00.000Z")), false);
  assert.equal(isLive(run("001", "done")), false);
});

test("nextLaunches respects maxParallel", () => {
  const runnable = [task("003"), task("001"), task("002"), task("004")];
  assert.deepEqual(nextLaunches(runnable, [], new Set(), 1).map((t) => t.id), ["001"]);
  // 3 at a time with one live (on a task that is not runnable any more) → two more.
  assert.deepEqual(nextLaunches(runnable, [run("009")], new Set(), 3).map((t) => t.id), ["001", "002"]);
  assert.deepEqual(nextLaunches(runnable, [run("009")], new Set(), 1), []);
});

test("nextLaunches skips live and finished tasks and keeps id order", () => {
  const runnable = [task("004"), task("002"), task("001"), task("003")];
  const runs = [run("001"), run("002", "done", "2026-11-18T01:00:00.000Z")];
  const launched = nextLaunches(runnable, runs, new Set(["003"]), 4).map((t) => t.id);
  assert.deepEqual(launched, ["002", "004"]);
});

test("sessionOver: only when nothing is live and nothing is left to launch", () => {
  const runnable = [task("001")];
  assert.equal(sessionOver(runnable, [], new Set(), 1), false);
  assert.equal(sessionOver(runnable, [], new Set(["001"]), 1), true);
  assert.equal(sessionOver([], [run("002")], new Set(), 1), false);
  assert.equal(sessionOver([], [run("002", "exited", "2026-11-18T01:00:00.000Z")], new Set(), 1), true);
});
