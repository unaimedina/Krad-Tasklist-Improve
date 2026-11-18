import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS,
  KEYS,
  filteredTasks,
  header,
  planBody,
  sidebarRows,
  sidebarView,
  statusBadge,
  taskDetail,
  taskRows,
  tasklistView,
} from "../dist/view.js";

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
    filter: "all",
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

test("the tab root fills its tab and the tasks pane holds a single-selection list", () => {
  const view = tasklistView(makeState());
  assert.equal(view.key, KEYS.root);
  assert.equal(view.style.height, "fill");
  assert.equal(view.style.width, "fill");
  const body = find(view, (n) => n.key === KEYS.body);
  assert.equal(body.style.height, "fill");
  const pane = find(view, (n) => n.key === KEYS.tasksPane);
  assert.equal(pane.style.height, "fill");
  const list = find(pane, (n) => n.key === KEYS.tasks);
  assert.equal(list.type, "list");
  assert.equal(list.selection, "single");
  assert.equal(list.count, 4);
  assert.ok(!find(view, (n) => n.type === "tree"));
});

test("taskRows returns one uniform row per task with menus", () => {
  const rows = taskRows(makeState());
  assert.deepEqual(rows.map((r) => r.node.key), ["001", "002", "003", "004"]);
  const byKey = Object.fromEntries(rows.map((r) => [r.node.key, r]));
  const badge = find(byKey["002"].node, (n) => n.type === "badge");
  assert.equal(badge.text, "running");
  assert.equal(badge.tone, "info");
  assert.equal(find(byKey["002"].node, (n) => n.key === "002-title").text, "Task 002");
  assert.equal(find(byKey["002"].node, (n) => n.key === "002-meta").text, "002 · P1 · M · after 001");
  assert.equal(find(byKey["001"].node, (n) => n.type === "icon").icon, "check");
  assert.equal(find(byKey["003"].node, (n) => n.type === "icon").color, "error");
  // Uniform shape: every row has the same node types in the same order.
  const shape = (row) => walk(row.node).map((n) => n.type).join(",");
  assert.equal(new Set(rows.map(shape)).size, 1);
  for (const row of rows) {
    assert.deepEqual(
      row.menu.map((m) => m.action),
      [ACTIONS.run, ACTIONS.runWorktree, ACTIONS.variants, ACTIONS.edit, ACTIONS.quickEdit],
    );
    const keys = walk(row.node).map((n) => n.key);
    assert.equal(new Set(keys).size, keys.length);
  }
  assert.deepEqual(taskRows(makeState(), 1, 3).map((r) => r.node.key), ["002", "003"]);
});

test("the filter narrows the list and its count", () => {
  const ids = (filter) => filteredTasks(makeState({ filter })).map((t) => t.id);
  assert.deepEqual(ids("all"), ["001", "002", "003", "004"]);
  assert.deepEqual(ids("todo"), ["002", "004"]);
  assert.deepEqual(ids("running"), ["002"]);
  assert.deepEqual(ids("done"), ["001"]);
  assert.deepEqual(ids("blocked"), ["003"]);
  const state = makeState({ filter: "todo" });
  assert.deepEqual(taskRows(state).map((r) => r.node.key), ["002", "004"]);
  const view = tasklistView(state);
  assert.equal(find(view, (n) => n.key === KEYS.tasks).count, 2);
  const select = find(view, (n) => n.action === ACTIONS.filter);
  assert.equal(select.type, "select");
  assert.equal(select.value, "todo");
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
  assert.deepEqual(statusBadge(task("x", "DONE"), run("x", "exited", { endedAt: "2026-11-18T11:00:00Z" })), {
    text: "done",
    tone: "success",
  });
});

test("header: chips, ghost icon buttons, one primary, stop during a session", () => {
  const idle = header(makeState());
  assert.equal(idle.key, KEYS.header);
  assert.deepEqual(idle.style.height, { fixed: 38 });
  const nodes = walk(idle);
  assert.equal(nodes.filter((n) => n.variant === "primary").length, 1);
  assert.equal(find(idle, (n) => n.variant === "primary").action, ACTIONS.autoRun);
  for (const action of [ACTIONS.newTask, ACTIONS.generate, ACTIONS.reconcile, ACTIONS.refresh]) {
    const button = find(idle, (n) => n.action === action);
    assert.equal(button.variant, "ghost", action);
    assert.ok(button.tooltip, action);
    assert.ok(!button.label, action);
  }
  assert.equal(find(idle, (n) => n.action === ACTIONS.runNext).variant, "secondary");
  assert.equal(find(idle, (n) => n.action === ACTIONS.runNext).enabled, "yes");
  assert.equal(find(idle, (n) => n.key === "header-done").text, "1/4 done");
  assert.equal(find(idle, (n) => n.key === "header-running").text, "1 running");
  assert.equal(find(idle, (n) => n.key === "header-blocked").tone, "error");

  const active = header(makeState({ session: { active: true, done: 1, total: 2, running: 1, message: null } }));
  const actions = walk(active).map((n) => n.action).filter(Boolean);
  assert.ok(actions.includes(ACTIONS.stop));
  assert.ok(!actions.includes(ACTIONS.autoRun));
  assert.equal(find(active, (n) => n.action === ACTIONS.stop).variant, "danger");

  const state = makeState({ runs: [] });
  state.set.tasks = state.set.tasks.map((t) => ({ ...t, status: "DONE" }));
  const none = header(state);
  assert.equal(find(none, (n) => n.action === ACTIONS.runNext).enabled, "no");
  assert.equal(find(none, (n) => n.action === ACTIONS.autoRun).enabled, "no");
  assert.equal(find(none, (n) => n.key === "header-done").tone, "success");
  assert.ok(!find(none, (n) => n.key === "header-running"));
});

test("planBody drops only the leading Plan heading", () => {
  assert.equal(planBody("# Plan 003: Do it\n\n## Status\n\nx"), "## Status\n\nx");
  assert.equal(planBody("\n# Plan 12: x\r\nbody"), "body");
  assert.equal(planBody("Intro\n# Plan 003: later"), "Intro\n# Plan 003: later");
});

test("taskDetail shows the plan, the note, and the quick editor", () => {
  const empty = taskDetail(makeState());
  assert.equal(empty.key, KEYS.detail);
  assert.ok(find(empty, (n) => n.type === "text" && n.text === "Select a task to read its plan"));
  assert.ok(find(empty, (n) => n.type === "icon" && n.icon === "tasks"));

  const plan = "# Plan 003: Task 003\n\nDo things.";
  const detail = taskDetail(makeState({ selected: "003", planText: plan }));
  assert.equal(detail.style.height, "fill");
  assert.equal(find(detail, (n) => n.key === "detail-plan-id").text, "Plan 003");
  assert.equal(find(detail, (n) => n.key === "detail-title").text, "Task 003");
  const scroll = find(detail, (n) => n.type === "scroll");
  assert.equal(scroll.style.height, "fill");
  const md = find(scroll, (n) => n.type === "markdown");
  assert.equal(md.text, "Do things.");
  const note = find(detail, (n) => n.type === "text" && n.text === "needs an API key");
  assert.equal(note.style.color, "warning");
  assert.equal(find(detail, (n) => n.type === "select").value, "BLOCKED");
  assert.equal(find(detail, (n) => n.key === "detail-run").variant, "primary");
  assert.equal(walk(detail).filter((n) => n.variant === "primary").length, 1);
  assert.equal(find(detail, (n) => n.key === "detail-info").entries[0].value, "plans/003-task-003.md");
  assert.ok(find(detail, (n) => n.type === "badge" && n.text === "Priority P1"));
  assert.ok(!find(detail, (n) => n.type === "form"));

  const editing = taskDetail(makeState({ selected: "003", planText: plan, editing: true }));
  const form = find(editing, (n) => n.type === "form");
  assert.equal(form.submit, ACTIONS.saveEdit);
  assert.equal(form.fields[0].value, plan);
  assert.ok(find(find(editing, (n) => n.type === "scroll"), (n) => n.action === ACTIONS.cancelEdit));
  assert.ok(!find(editing, (n) => n.type === "markdown"));

  // Live run: a spinner instead of Run, worktree disabled, run info shown.
  const running = taskDetail(makeState({ selected: "002", planText: plan }));
  assert.ok(!find(running, (n) => n.key === "detail-run"));
  assert.ok(find(running, (n) => n.type === "spinner"));
  assert.equal(find(running, (n) => n.key === "detail-running").text, "Running with Claude Code");
  assert.equal(find(running, (n) => n.key === "detail-run-worktree").enabled, "no");
  const info = find(running, (n) => n.type === "details");
  assert.ok(info.entries.some((e) => e.label === "Agent" && e.value === "Claude Code"));
});

test("tasklistView without a plans folder shows the empty state", () => {
  const state = makeState();
  state.set = { ...state.set, dir: null, indexFile: null, tasks: [] };
  const view = tasklistView(state);
  assert.equal(view.key, KEYS.root);
  const empty = find(view, (n) => n.key === KEYS.empty);
  assert.ok(find(empty, (n) => n.type === "text" && n.text.startsWith("No plans in this folder yet")));
  assert.equal(find(empty, (n) => n.action === ACTIONS.generate).variant, "secondary");
  assert.equal(find(empty, (n) => n.action === ACTIONS.newTask).variant, "secondary");
  assert.ok(!find(view, (n) => n.key === KEYS.tasks));
});

test("tasklistView session strip and collapsed problems", () => {
  const state = makeState({ session: { active: true, done: 1, total: 3, running: 1, message: "running 002" } });
  state.set.problems = ["p1", "p2", "p3", "p4", "p5"];
  const view = tasklistView(state);
  const session = find(view, (n) => n.key === KEYS.session);
  assert.ok(find(session, (n) => n.type === "spinner"));
  assert.equal(find(session, (n) => n.key === "session-text").text, "Auto-run · 1 of 3 done · 1 running");
  assert.equal(find(session, (n) => n.key === "session-message").text, "running 002");
  const problems = find(view, (n) => n.key === KEYS.problems);
  assert.equal(problems.children.length, 4);
  assert.equal(problems.children[0].style.color, "warning");
  assert.equal(problems.children[3].text, "and 2 more");
  assert.ok(!find(tasklistView(makeState()), (n) => n.key === KEYS.session));
});

test("the sidebar is compact: ghost buttons, a list, one-line rows", () => {
  const view = sidebarView(makeState());
  assert.ok(!walk(view).some((n) => n.variant === "primary"));
  assert.equal(find(view, (n) => n.action === ACTIONS.openTab).icon, "open-external");
  for (const action of [ACTIONS.openTab, ACTIONS.runNext, ACTIONS.refresh]) {
    const button = find(view, (n) => n.action === action);
    assert.equal(button.variant, "ghost", action);
    assert.ok(button.tooltip, action);
  }
  assert.equal(find(view, (n) => n.key === "sidebar-done").text, "1/4 done");
  const list = find(view, (n) => n.key === KEYS.sidebarTasks);
  assert.equal(list.type, "list");
  assert.equal(list.selection, "single");
  assert.equal(list.count, 4);
  const rows = sidebarRows(makeState());
  assert.deepEqual(rows.map((r) => r.node.key), ["001", "002", "003", "004"]);
  assert.ok(!walk(rows[0].node).some((n) => n.type === "flex" && n.direction === "column"));

  const noPlans = makeState();
  noPlans.set = { ...noPlans.set, dir: null, tasks: [] };
  const empty = sidebarView(noPlans);
  assert.ok(!walk(empty).some((n) => n.variant === "primary"));
  assert.equal(find(empty, (n) => n.action === ACTIONS.generate).variant, "ghost");
  assert.ok(!find(empty, (n) => n.key === KEYS.sidebarTasks));
  assert.ok(find(sidebarView(null), (n) => n.text === "Open a group to see its tasks."));
});

test("all keys in the views are unique", () => {
  const variants = [
    {},
    { selected: "002", planText: "# x" },
    { selected: "003", planText: "# x", editing: true },
    { session: { active: true, done: 0, total: 2, running: 1, message: "m" } },
  ];
  for (const overrides of variants) {
    const state = makeState(overrides);
    state.set.problems = ["one", "two", "three", "four"];
    for (const view of [tasklistView(state), sidebarView(state)]) {
      const keys = walk(view).map((n) => n.key);
      assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys}`);
    }
  }
});
