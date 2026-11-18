import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, KEYS, statusBadge, taskDetail, taskItems, tasklistView, toolbar } from "../dist/view.js";

const ROOT = "/repo";

function task(id, status, extra = {}) {
  return {
    id,
    slug: `task-${id}`,
    file: `${ROOT}/plans/${id}-task-${id}.md`,
    title: `Task ${id}`,
    priority: "P1",
    effort: "M",
    risk: "LOW",
    dependsOn: [],
    status,
    statusNote: null,
    ...extra,
  };
}

function run(taskId, state, extra = {}) {
  return {
    taskId,
    root: ROOT,
    terminal: 7,
    harness: "claude",
    mode: "here",
    cwd: ROOT,
    worktree: null,
    branch: null,
    state,
    startedAt: "2026-11-18T10:00:00.000Z",
    endedAt: null,
    ...extra,
  };
}

function makeState(overrides = {}) {
  return {
    set: {
      root: ROOT,
      dir: `${ROOT}/plans`,
      indexFile: `${ROOT}/plans/README.md`,
      tasks: [
        task("001", "DONE"),
        task("002", "TODO", { dependsOn: ["001"] }),
        task("003", "BLOCKED", { statusNote: "needs an API key" }),
        task("004", "TODO"),
      ],
      problems: [],
    },
    runs: [run("002", "working")],
    selected: null,
    editing: false,
    planText: null,
    session: { active: false, done: 0, total: 0, running: 0, message: null },
    ...overrides,
  };
}

/** Every node of a view tree, depth first. */
function walk(node, out = []) {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}

const find = (root, predicate) => walk(root).find(predicate);

test("taskItems lists tasks with badges and inline run actions", () => {
  const items = taskItems(makeState());
  assert.deepEqual(items.map((i) => i.key), ["001", "002", "003", "004"]);
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.deepEqual(byKey["002"].badge, { text: "running", tone: "info" });
  assert.equal(byKey["002"].label, "002 · Task 002");
  assert.equal(byKey["002"].description, "P1 · M · after 001");
  assert.equal(byKey["001"].icon, "check");
  assert.ok(!byKey["001"].actions.some((a) => a.action === ACTIONS.run));
  assert.ok(byKey["004"].actions.some((a) => a.action === ACTIONS.run));
  assert.ok(byKey["003"].actions.some((a) => a.action === ACTIONS.run));
  // 002 is TODO but has a live run: no inline run.
  assert.ok(!byKey["002"].actions.some((a) => a.action === ACTIONS.run));
  for (const item of items) {
    assert.equal(item.actions[0].action, ACTIONS.select);
    assert.deepEqual(
      item.menu.map((m) => m.action),
      [ACTIONS.run, ACTIONS.runWorktree, ACTIONS.variants, ACTIONS.edit, ACTIONS.quickEdit],
    );
  }
});

test("statusBadge maps every status and live states", () => {
  assert.deepEqual(statusBadge(task("x", "TODO"), null), { text: "todo", tone: "neutral" });
  assert.deepEqual(statusBadge(task("x", "IN PROGRESS"), null), { text: "in progress", tone: "info" });
  assert.deepEqual(statusBadge(task("x", "DONE"), null), { text: "done", tone: "success" });
  assert.deepEqual(statusBadge(task("x", "BLOCKED"), null), { text: "blocked", tone: "error" });
  assert.deepEqual(statusBadge(task("x", "REJECTED"), null), { text: "rejected", tone: "neutral" });
  for (const state of ["starting", "working", "idle", "unknown"]) {
    assert.deepEqual(statusBadge(task("x", "DONE"), run("x", state)), { text: "running", tone: "info" });
  }
  assert.deepEqual(statusBadge(task("x", "TODO"), run("x", "waiting-for-input")), {
    text: "needs you",
    tone: "warning",
  });
  // A finished run falls back to the plan status.
  assert.deepEqual(statusBadge(task("x", "DONE"), run("x", "exited", { endedAt: "2026-11-18T11:00:00Z" })), {
    text: "done",
    tone: "success",
  });
});

test("toolbar swaps auto-run for stop during a session and disables runs without TODO", () => {
  const active = toolbar(makeState({ session: { active: true, done: 1, total: 2, running: 1, message: null } }));
  assert.equal(active.key, KEYS.toolbar);
  const actions = walk(active).map((n) => n.action).filter(Boolean);
  assert.ok(actions.includes(ACTIONS.stop));
  assert.ok(!actions.includes(ACTIONS.autoRun));

  const idle = toolbar(makeState());
  const idleActions = walk(idle).map((n) => n.action).filter(Boolean);
  assert.ok(idleActions.includes(ACTIONS.autoRun));
  assert.ok(!idleActions.includes(ACTIONS.stop));
  assert.equal(find(idle, (n) => n.action === ACTIONS.runNext).enabled, "yes");

  const state = makeState();
  state.set.tasks = state.set.tasks.map((t) => ({ ...t, status: "DONE" }));
  const none = toolbar(state);
  assert.equal(find(none, (n) => n.action === ACTIONS.runNext).enabled, "no");
  assert.equal(find(none, (n) => n.action === ACTIONS.autoRun).enabled, "no");
});

test("taskDetail shows the plan, the note, and the quick editor", () => {
  const empty = taskDetail(makeState());
  assert.equal(empty.key, KEYS.detail);
  assert.ok(find(empty, (n) => n.type === "text" && n.text === "Select a task to read its plan."));

  const plan = "# Plan 003\n\nDo things.";
  const detail = taskDetail(makeState({ selected: "003", planText: plan }));
  const md = find(detail, (n) => n.type === "markdown");
  assert.ok(md);
  assert.equal(md.text, plan);
  const note = find(detail, (n) => n.type === "text" && n.text === "needs an API key");
  assert.equal(note.style.color, "warning");
  assert.equal(find(detail, (n) => n.type === "select").value, "BLOCKED");
  assert.ok(!find(detail, (n) => n.type === "form"));

  const editing = taskDetail(makeState({ selected: "003", planText: plan, editing: true }));
  const form = find(editing, (n) => n.type === "form");
  assert.equal(form.submit, ACTIONS.saveEdit);
  assert.equal(form.fields[0].value, plan);
  assert.ok(find(editing, (n) => n.action === ACTIONS.cancelEdit));
  assert.ok(!find(editing, (n) => n.type === "markdown"));

  // Live run: Run buttons disabled and run info shown.
  const running = taskDetail(makeState({ selected: "002", planText: plan }));
  assert.equal(find(running, (n) => n.key === "detail-run").enabled, "no");
  assert.equal(find(running, (n) => n.key === "detail-run-worktree").enabled, "no");
  const info = find(running, (n) => n.type === "details");
  assert.ok(info.entries.some((e) => e.label === "Agent" && e.value === "claude"));
});

test("tasklistView shows the empty-folder text when there is no plans folder", () => {
  const state = makeState();
  state.set = { ...state.set, dir: null, indexFile: null, tasks: [] };
  const view = tasklistView(state);
  assert.equal(view.key, KEYS.root);
  assert.ok(find(view, (n) => n.type === "text" && n.text.startsWith("No plans in this folder yet")));
});

test("tasklistView summary and problems", () => {
  const state = makeState({ session: { active: true, done: 1, total: 3, running: 1, message: "running 002" } });
  state.set.problems = ["plans/README.md: row 009 has no plan file"];
  const view = tasklistView(state);
  const summaryNode = find(view, (n) => n.key === KEYS.summary);
  assert.equal(summaryNode.text, "Auto-run: 1 of 4 done · 1 running · 1 blocked · running 002");
  const problems = find(view, (n) => n.key === KEYS.problems);
  assert.equal(problems.children[0].style.color, "warning");
});

test("all keys in tasklistView are unique", () => {
  for (const overrides of [{}, { selected: "002", planText: "# x" }, { selected: "003", planText: "# x", editing: true }]) {
    const state = makeState(overrides);
    state.set.problems = ["one", "two"];
    const keys = walk(tasklistView(state)).map((n) => n.key);
    assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys}`);
  }
});
