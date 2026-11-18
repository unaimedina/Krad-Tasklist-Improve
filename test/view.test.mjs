import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS,
  busyKey,
  APP_ROW_PAD_X,
  PANE_PAD,
  PANE_W,
  ROW_BODY_W,
  ROW_GAP,
  ROW_LEAD_W,
  ROW_PAD,
  ROW_STATUS_W,
  ROW_TEXT_W,
  STACK_TASKS_H,
  WHOLE_PLAN,
  ALL_SECTIONS,
  planParts,
  planScroll,
  planSections,
  planSignature,
  sectionSelect,
  sectionTitle,
  sectionValue,
  KEYS,
  filteredTasks,
  header,
  titleLines,
  TITLE_LINE_CHARS,
  noGroupView,
  planBody,
  statusBadge,
  taskDetail,
  taskRows,
  tasklistView,
  viewShape,
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
  assert.equal(view.style.padding, "lg");
  assert.equal(view.style.gap, "lg");
  const body = find(view, (n) => n.key === KEYS.body);
  assert.equal(body.style.height, "fill");
  assert.equal(body.style.gap, "lg");
  // Left pane: fixed width, stretched by the body row; right pane grows sideways with height fill.
  const pane = find(view, (n) => n.key === KEYS.tasksPane);
  assert.deepEqual(pane.style.width, { fixed: PANE_W });
  assert.notEqual(pane.style.height, "fill");
  assert.equal(pane.style.padding, "md");
  const detail = find(view, (n) => n.key === KEYS.detail);
  assert.equal(detail.style.height, "fill");
  assert.equal(detail.style.width, undefined);
  // Pane header on its own line, the filter chips on the next one.
  assert.deepEqual(pane.children.map((n) => n.key), [KEYS.tasksPaneHeader, "tasks-filter", KEYS.tasks]);
  assert.equal(find(pane, (n) => n.key === "tasks-count").text, "4");
  const list = find(pane, (n) => n.key === KEYS.tasks);
  assert.equal(list.type, "list");
  assert.equal(list.selection, "single");
  assert.equal(list.count, 4);
  assert.ok(!find(view, (n) => n.type === "tree"));
  // An empty view keeps the pane, its header and its filter, with one sentence instead of the list.
  const state = makeState({ filter: "blocked" });
  state.set.tasks = state.set.tasks.filter((t) => t.status !== "BLOCKED");
  const empty = tasklistView(state);
  const emptyPane = find(empty, (n) => n.key === KEYS.tasksPane);
  assert.deepEqual(emptyPane.children.map((n) => n.key), [KEYS.tasksPaneHeader, "tasks-filter", KEYS.tasksEmpty]);
  assert.equal(find(emptyPane, (n) => n.key === KEYS.tasksEmpty).text, "No task is blocked.");
  assert.equal(find(emptyPane, (n) => n.key === "tasks-count").text, "0 of 3");
});

test("taskRows returns one uniform row per task: id, title, one status mark", () => {
  const rows = taskRows(makeState());
  assert.deepEqual(rows.map((r) => r.node.key), ["001", "002", "003", "004"]);
  const byKey = Object.fromEntries(rows.map((r) => [r.node.key, r]));
  // The task an agent works on: a spinner is its status mark, in place of a pill.
  assert.ok(!find(byKey["002"].node, (n) => n.type === "badge"));
  assert.equal(byKey["002"].node.children[2].type, "spinner");
  assert.equal(find(byKey["004"].node, (n) => n.type === "badge").text, "todo");
  assert.equal(find(byKey["002"].node, (n) => n.key === "002-title").text, "Task 002");
  assert.equal(find(byKey["002"].node, (n) => n.key === "002-meta").text, "P1 · M · after 001");
  // A spinner only on the task an agent works on.
  for (const id of ["001", "003", "004"]) assert.ok(!find(byKey[id].node, (n) => n.type === "spinner"), id);
  for (const row of rows) {
    assert.equal(row.menu, undefined);
    // Row body: one fixed width for all rows (the app sizes rows to their content), centred.
    assert.equal(row.node.align, "center");
    assert.deepEqual(row.node.style.width, { fixed: ROW_BODY_W });
    assert.equal(row.node.style.padding, "sm");
    // One status mark per row: a pill or a spinner. No status icon besides it.
    assert.equal(walk(row.node).filter((n) => n.type === "badge" || n.type === "spinner").length, 1);
    assert.ok(!find(row.node, (n) => n.type === "icon"));
    // Fixed-width columns on both sides, so titles never move when a status or a spinner changes.
    assert.equal(find(row.node, (n) => n.key.endsWith("-number")).text, row.node.key);
    assert.deepEqual(find(row.node, (n) => n.key.endsWith("-lead")).style.width, { fixed: ROW_LEAD_W });
    // The mark right after the fixed text column, so every mark starts on one edge.
    assert.equal(row.node.children.length, 3);
    assert.ok(["badge", "spinner"].includes(row.node.children[2].type));
    // Few nodes per row: the list renders every visible row.
    assert.ok(walk(row.node).length <= 8, `${row.node.key}: ${walk(row.node).length} nodes`);
    assert.equal(find(row.node, (n) => n.key.endsWith("-title-2")).style.wrap, "no_wrap");
    assert.equal(find(row.node, (n) => n.key.endsWith("-text")).align, "start");
    const keys = walk(row.node).map((n) => n.key);
    assert.equal(new Set(keys).size, keys.length);
  }
  // Uniform shape: rows differ only in their mark (pill or spinner).
  const shape = (row) => walk({ ...row.node, children: row.node.children.slice(0, 2) }).map((n) => n.type).join(",");
  assert.equal(new Set(rows.map(shape)).size, 1);
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

test("header: chips, ghost icon buttons, no accent, stop during a session, busy Run next", () => {
  const idle = header(makeState());
  assert.equal(idle.key, KEYS.header);
  assert.equal(idle.justify, "between");
  assert.equal(idle.align, "center");
  // A narrow window wraps the header onto more lines; the title never wraps.
  assert.equal(idle.wrap, "wrap");
  assert.equal(find(idle, (n) => n.key === "header-right").wrap, "wrap");
  assert.equal(find(idle, (n) => n.key === "header-title").style.wrap, "no_wrap");
  assert.equal(find(idle, (n) => n.key === "header-title").style.size, "lg");
  // The ghost icon buttons sit in a bordered pill, the layout toggle last.
  const pill = find(idle, (n) => n.key === "header-tools");
  assert.equal(pill.style.radius, "full");
  assert.equal(pill.style.border, "border");
  assert.deepEqual(
    pill.children.map((n) => n.action),
    [ACTIONS.newTask, ACTIONS.generate, ACTIONS.reconcile, ACTIONS.refresh, ACTIONS.layout],
  );
  // The one accent of the screen is the selected task's Run: none in the header.
  assert.ok(!walk(idle).some((n) => n.variant === "primary"));
  assert.equal(find(idle, (n) => n.action === ACTIONS.autoRun).variant, "secondary");
  for (const action of [ACTIONS.newTask, ACTIONS.generate, ACTIONS.reconcile, ACTIONS.refresh, ACTIONS.layout]) {
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

  // While Run next starts an agent, its button says so and cannot be pressed twice.
  const starting = header(makeState({ busy: [busyKey.runNext] }));
  const next = find(starting, (n) => n.action === ACTIONS.runNext);
  assert.equal(next.label, "Starting…");
  assert.equal(next.icon, "loading");
  assert.equal(next.enabled, "no");
  assert.equal(next.key, "toolbar-run-next");
});

test("planBody drops the leading Plan heading and the Status section", () => {
  assert.equal(
    planBody("# Plan 003: Do it\n\n## Status\n\n- **Priority**: P1\n\n## Steps\n\n1. x\n\n## Done\n"),
    "## Steps\n\n1. x\n\n## Done\n",
  );
  assert.equal(planBody("# Plan 003: Do it\n\n## Status\n\nonly status"), "");
  assert.equal(planBody("\n# Plan 12: x\r\n## Status\r\n- a\r\n## Why\r\nbody"), "## Why\r\nbody");
  assert.equal(planBody("\n# Plan 12: x\r\nbody"), "body");
  assert.equal(planBody("Intro\n# Plan 003: later"), "Intro\n# Plan 003: later");
  // "### Status" or "## Statuses" are kept.
  assert.equal(planBody("### Status\nx\n## Statuses\ny"), "### Status\nx\n## Statuses\ny");
});

test("taskDetail shows the plan, the note, and the quick editor", () => {
  const empty = taskDetail(makeState());
  assert.equal(empty.key, KEYS.detail);
  assert.ok(find(empty, (n) => n.type === "text" && n.text === "Select a task to read its plan"));
  assert.ok(find(empty, (n) => n.type === "icon" && n.icon === "tasks"));
  assert.equal(empty.style.padding, "xl");
  assert.equal(empty.style.height, "fill");

  const plan = "# Plan 003: Task 003\n\n## Status\n\n- **Priority**: P1\n\n## Steps\n\nDo things.";
  const twoSections = "# Plan 003: Task 003\n\nIntro.\n\n## Steps\n\nDo things.";
  const detail = taskDetail(makeState({ selected: "003", planText: plan }));
  assert.equal(detail.style.height, "fill");
  assert.equal(detail.style.padding, "lg");
  assert.equal(detail.style.gap, "md");
  // Top (patched alone on data changes), divider, plan scroll (left alone so it keeps its scroll).
  assert.deepEqual(detail.children.map((n) => n.key), [KEYS.detailTop, "detail-divider", KEYS.plan]);
  assert.equal(detail.align, "stretch");
  assert.equal(detail.children[0].align, "stretch");
  // Sentence case, no tracked uppercase eyebrow.
  assert.equal(find(detail, (n) => n.key === "detail-plan-id").text, "Plan 003");
  const chipsRow = find(detail, (n) => n.key === "detail-chips");
  assert.equal(chipsRow.style.gap, "sm");
  // One status mark: the status row's pill. No chip repeats it.
  assert.ok(!find(chipsRow, (n) => n.text === "blocked"));
  // Actions: one row that wraps, the icon-only editors in it (no justify between to overlap them).
  const actionsRow = find(detail, (n) => n.key === "detail-actions");
  assert.equal(actionsRow.wrap, "wrap");
  assert.equal(actionsRow.justify, "start");
  assert.equal(actionsRow.style.gap, "sm");
  const editors = actionsRow.children.slice(-3);
  for (const button of editors) {
    assert.equal(button.variant, "ghost");
    assert.ok(button.tooltip && !button.label);
  }
  assert.deepEqual(editors.map((n) => n.icon), ["note", "open-external", "magic"]);
  assert.deepEqual(editors.map((n) => n.tooltip), ["Edit in editor", "Open in Krad's viewer", "Edit with a prompt"]);
  assert.deepEqual(editors.map((n) => n.action), [ACTIONS.edit, ACTIONS.openViewer, ACTIONS.quickEdit]);
  // Status: the pill and a "Change status" button to the app's picker; no five-option select.
  const statusRow = find(detail, (n) => n.key === "detail-status-row");
  assert.equal(statusRow.wrap, "wrap");
  assert.deepEqual(statusRow.children.map((n) => n.type), ["text", "badge", "button"]);
  assert.equal(find(statusRow, (n) => n.type === "badge").text, "blocked");
  const change = find(statusRow, (n) => n.type === "button");
  assert.equal(change.action, ACTIONS.setStatus);
  assert.equal(change.label, "Change status");
  assert.equal(change.icon, "pencil");
  assert.equal(change.variant, "ghost");
  assert.ok(detail.children[0].children.includes(statusRow));
  assert.ok(!find(detail, (n) => n.type === "select"), "no select: one section, status by picker");
  // File: one small mono line, no details table without a run.
  assert.equal(find(detail, (n) => n.key === "detail-file-path").text, "plans/003-task-003.md");
  assert.equal(find(detail, (n) => n.key === "detail-file-path").style.font, "mono");
  assert.ok(!find(detail, (n) => n.type === "details"));
  assert.equal(find(detail, (n) => n.key === "detail-title").text, "Task 003");
  const scroll = find(detail, (n) => n.type === "scroll");
  assert.equal(scroll.style.height, "fill");
  const md = find(scroll, (n) => n.type === "markdown");
  assert.equal(md.text, "Do things.");
  // Two sections: a section select over the scroll, the first section shown.
  const sectioned = taskDetail(makeState({ selected: "003", planText: twoSections }));
  const sections = find(sectioned, (n) => n.key === KEYS.planSections);
  assert.deepEqual(sections.options.map((o) => o.label), ["All", "Overview", "Steps"]);
  assert.equal(sections.value, sectionValue(0));
  assert.equal(find(sectioned, (n) => n.type === "markdown").text, "Intro.");
  const note = find(detail, (n) => n.type === "text" && n.text === "needs an API key");
  assert.equal(note.style.color, "warning");
  assert.equal(find(detail, (n) => n.key === "detail-run").variant, "primary");
  assert.equal(walk(detail).filter((n) => n.variant === "primary").length, 1);
  assert.ok(find(detail, (n) => n.type === "badge" && n.text === "Priority P1"));
  assert.ok(!find(detail, (n) => n.type === "form"));

  // No in-tab editor: the plan pane only reads.
  assert.ok(!find(detail, (n) => n.type === "input"));

  // Live run: a spinner instead of Run, worktree disabled, run info shown.
  const running = taskDetail(makeState({ selected: "002", planText: plan }));
  assert.ok(!find(running, (n) => n.key === "detail-run"));
  assert.ok(find(running, (n) => n.type === "spinner"));
  assert.equal(find(running, (n) => n.key === "detail-running").text, "Running with Claude Code");
  assert.equal(find(running, (n) => n.key === "detail-run-worktree").enabled, "no");
  const info = find(running, (n) => n.type === "details");
  assert.ok(info.entries.some((e) => e.label === "Agent" && e.value === "Claude Code"));
  // The live state is the one chip the status select cannot say.
  assert.equal(find(running, (n) => n.key === "detail-live").text, "running");

  // While Run starts the agent: same button, same key, "Starting…", disabled; worktree disabled too.
  const starting = taskDetail(makeState({ selected: "004", planText: plan, busy: [busyKey.run("004")] }));
  const run = find(starting, (n) => n.key === "detail-run");
  assert.equal(run.label, "Starting…");
  assert.equal(run.icon, "loading");
  assert.equal(run.enabled, "no");
  assert.equal(find(starting, (n) => n.key === "detail-run-worktree").enabled, "no");
});

test("viewShape changes only with the structure, not with the data shown", () => {
  const base = viewShape(makeState({ selected: "003", planText: "a" }));
  assert.equal(viewShape(makeState({ selected: "003", planText: "b" })), base);
  assert.equal(viewShape(makeState({ selected: "003", planText: "a", runs: [] })), base);
  assert.notEqual(viewShape(makeState({ selected: "004", planText: "a" })), base);
  assert.notEqual(
    viewShape(makeState({ selected: "003", planText: "a", session: { active: true, done: 0, total: 1, running: 0, message: null } })),
    base,
  );
  const noBlocked = makeState({ selected: "003", planText: "a", filter: "blocked" });
  noBlocked.set.tasks = noBlocked.set.tasks.map((t) => (t.status === "BLOCKED" ? { ...t, status: "TODO" } : t));
  assert.notEqual(viewShape(noBlocked), viewShape(makeState({ selected: "003", planText: "a", filter: "blocked" })));
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

const PAGE = { groups: [{ value: ROOT, label: "repo" }, { value: "/other", label: "other" }] };

test("the Tasks page is the tab's UI plus Open in a tab and a group button", () => {
  const state = makeState({ selected: "003", planText: "# Plan 003: x\n\nbody" });
  const tab = tasklistView(state);
  const page = tasklistView(state, PAGE);
  // Same structure: header, body with the tasks pane (single-selection list) and the plan pane.
  for (const view of [tab, page]) {
    assert.deepEqual(view.children.map((n) => n.key), [KEYS.header, KEYS.body]);
    const body = find(view, (n) => n.key === KEYS.body);
    assert.deepEqual(body.children.map((n) => n.key), [KEYS.tasksPane, KEYS.detail]);
    assert.equal(find(view, (n) => n.key === KEYS.tasks).selection, "single");
    assert.ok(find(view, (n) => n.type === "markdown"));
  }
  assert.deepEqual(find(page, (n) => n.key === KEYS.body), find(tab, (n) => n.key === KEYS.body));
  // Open in a tab: in the page's pill only.
  const open = find(page, (n) => n.action === ACTIONS.openTab);
  assert.equal(open.variant, "ghost");
  assert.equal(open.icon, "open-external");
  assert.equal(open.tooltip, "Open in a tab");
  assert.ok(find(find(page, (n) => n.key === "header-tools"), (n) => n === open));
  assert.ok(!find(tab, (n) => n.action === ACTIONS.openTab));
  // A group button (to the app's picker) only with several groups: one compact control, not a row of chips.
  const group = find(page, (n) => n.action === ACTIONS.group);
  assert.equal(group.type, "button");
  assert.equal(group.label, "repo");
  assert.equal(group.icon, "chevron-down");
  assert.equal(group.variant, "ghost");
  assert.ok(!find(tab, (n) => n.action === ACTIONS.group));
  const single = tasklistView(state, { groups: [{ value: ROOT, label: "repo" }] });
  assert.ok(!find(single, (n) => n.action === ACTIONS.group));
  assert.ok(find(single, (n) => n.key === "header-folder"));
  assert.ok(find(single, (n) => n.action === ACTIONS.openTab));
});

test("the page without a group shows a centred empty state", () => {
  const view = noGroupView();
  assert.equal(view.key, KEYS.root);
  assert.equal(view.style.height, "fill");
  const empty = find(view, (n) => n.key === KEYS.empty);
  assert.equal(empty.style.padding, "xl");
  assert.ok(find(empty, (n) => n.text === "Open a group to see its tasks."));
});

/** Rows (flex row) with siblings whose child has width fill: that child would overflow the row. */
function widthFillInRows(node) {
  return walk(node)
    .filter((n) => n.type === "flex" && n.direction === "row" && (n.children ?? []).length > 1)
    .flatMap((n) => n.children.filter((c) => c.style?.width === "fill").map((c) => `${n.key} > ${c.key}`));
}

test("no row gives width fill to a child that has siblings", () => {
  const variants = [
    {},
    { selected: "002", planText: "# Plan 002: x\n\nbody" },
    { selected: "003", planText: "# x" },
    { session: { active: true, done: 0, total: 2, running: 1, message: "m" } },
  ];
  for (const overrides of variants) {
    const state = makeState(overrides);
    state.set.problems = ["one"];
    const nodes = [
      tasklistView(state),
      tasklistView(state, PAGE),
      ...taskRows(state).map((r) => r.node),
    ];
    for (const node of nodes) assert.deepEqual(widthFillInRows(node), [], node.key);
  }
  const noPlans = makeState();
  noPlans.set = { ...noPlans.set, dir: null, tasks: [] };
  assert.deepEqual(widthFillInRows(tasklistView(noPlans)), []);
  const empty = find(tasklistView(noPlans), (n) => n.key === KEYS.empty);
  assert.equal(empty.style.padding, "xl");
});

test("all keys in the views are unique", () => {
  const variants = [
    {},
    { selected: "002", planText: "# x" },
    { selected: "003", planText: "# x" },
    { session: { active: true, done: 0, total: 2, running: 1, message: "m" } },
  ];
  for (const overrides of variants) {
    const state = makeState(overrides);
    state.set.problems = ["one", "two", "three", "four"];
    for (const view of [tasklistView(state), tasklistView(state, PAGE)]) {
      const keys = walk(view).map((n) => n.key);
      assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys}`);
    }
  }
});

test("titleLines fits any title in two equal-height lines", () => {
  assert.deepEqual(titleLines("Draw the Tasklist tab"), ["Draw the Tasklist tab", ""]);
  assert.deepEqual(titleLines("Draw the Tasklist tab (`src/view.ts`)"), ["Draw the Tasklist tab", "(src/view.ts)"]);
  assert.deepEqual(titleLines("Scaffold the \"Tasklist\" Krad ADE extension from the krad-docker skeleton"), [
    "Scaffold the \"Tasklist\"",
    "Krad ADE extension from…",
  ]);
  const long = titleLines("Wire the tab, agent runs, the auto-run session and agent tools (`src/main.ts`, `src/scheduler.ts`)");
  assert.equal(long[0], "Wire the tab, agent runs,");
  assert.ok(long[1].endsWith("…"));
  const words = titleLines("x".repeat(100));
  assert.equal(words[0].length, TITLE_LINE_CHARS);
  for (const title of ["a", "a b c ".repeat(40), "y".repeat(200), "  spaced   out  "]) {
    for (const line of titleLines(title)) assert.ok(line.length <= TITLE_LINE_CHARS, `${title} -> ${line}`);
  }
  // A short title still gives a second (blank) line so every row has the same height.
  const row = taskRows(makeState())[0].node;
  assert.equal(find(row, (n) => n.key === "001-title-2").text, " ");
});

/** The nodes from `root` down to the node with `key` (excluded), or null. */
function ancestors(root, key, path = []) {
  if (root.key === key) return path;
  for (const child of root.children ?? []) {
    const found = ancestors(child, key, [...path, root]);
    if (found) return found;
  }
  return null;
}

test("every row highlight spans the whole pane: every ancestor of the list and the plan stretches", () => {
  // The renderer centres a flex's children when align is not set: every ancestor sets stretch explicitly.
  const states = [makeState(), makeState({ selected: "002", planText: "# x" }), makeState({ filter: "todo" })];
  const page = { groups: [{ value: ROOT, label: "repo" }, { value: "/other", label: "other" }] };
  for (const state of states) {
    for (const view of [tasklistView(state), tasklistView(state, page)]) {
      const path = ancestors(view, KEYS.tasks);
      assert.deepEqual(path.map((n) => n.key), [KEYS.root, KEYS.body, KEYS.tasksPane]);
      for (const node of path) assert.equal(node.align, "stretch", node.key);
      const planPath = ancestors(view, KEYS.plan);
      if (planPath !== null) {
        assert.deepEqual(planPath.map((n) => n.key), [KEYS.root, KEYS.body, KEYS.detail]);
        for (const node of planPath) assert.equal(node.align, "stretch", node.key);
      }
    }
    for (const row of taskRows(state)) {
      assert.equal(row.node.type, "flex");
      assert.equal(row.node.direction, "row");
      assert.deepEqual(row.node.style.width, { fixed: ROW_BODY_W }, row.node.key);
    }
  }
  assert.equal(noGroupView().align, "stretch");
});

test("every task row has the same fixed width: two fixed columns, then the status area", () => {
  // The numbers: pane 380, padding 12, app row padding 8 → row body 340; 340 - 2·8 padding - 2·8 gaps
  // = 308 = id 36 + text 184 + status area 88.
  assert.equal(ROW_BODY_W, PANE_W - 2 * PANE_PAD - 2 * APP_ROW_PAD_X);
  assert.equal(PANE_W, 380);
  assert.equal(ROW_BODY_W, 340);
  assert.equal(ROW_STATUS_W, 88);
  assert.equal(ROW_TEXT_W, 184);
  assert.equal(ROW_LEAD_W + ROW_TEXT_W + ROW_STATUS_W + 2 * ROW_GAP + 2 * ROW_PAD, ROW_BODY_W);
  const space = { xs: 4, sm: 8, md: 12, lg: 20, xl: 24 };
  const page = { groups: [{ value: ROOT, label: "repo" }, { value: "/other", label: "other" }] };
  const states = [
    makeState(),
    makeState({ filter: "todo" }),
    makeState({ runs: [run("004", "working")] }),
    makeState({ layout: "stack" }),
    makeState({ set: { ...makeState().set, tasks: [task("001", "TODO", { title: "x".repeat(120) }), task("002", "DONE", { title: "y" })] } }),
  ];
  for (const state of states) {
    // The pane has the width (side by side) and padding the row width is derived from; stacked it
    // takes the full width and a fixed height, and the rows keep their geometry.
    for (const view of [tasklistView(state), tasklistView(state, page)]) {
      const pane = find(view, (n) => n.key === KEYS.tasksPane);
      if (state.layout === "stack") {
        assert.equal(pane.style.width, "fill");
        assert.deepEqual(pane.style.height, { fixed: STACK_TASKS_H });
      } else {
        assert.deepEqual(pane.style.width, { fixed: PANE_W });
      }
      assert.equal(space[pane.style.padding], PANE_PAD);
    }
    const widths = new Set();
    for (const row of taskRows(state)) {
      const body = row.node;
      assert.deepEqual(body.style.width, { fixed: ROW_BODY_W }, body.key);
      assert.equal(space[body.style.padding], ROW_PAD);
      assert.equal(space[body.style.gap], ROW_GAP);
      const [lead, text, mark] = body.children;
      assert.deepEqual(lead.style.width, { fixed: ROW_LEAD_W });
      assert.deepEqual(text.style.width, { fixed: ROW_TEXT_W });
      assert.ok(["badge", "spinner"].includes(mark.type));
      assert.equal(body.children.length, 3);
      widths.add(JSON.stringify(body.style.width));
    }
    assert.equal(widths.size, 1);
  }
});

test("the layout toggle stacks the panes: tasks on top at a fixed height, the plan under it", () => {
  const side = tasklistView(makeState({ selected: "003", planText: "# x" }));
  const stacked = tasklistView(makeState({ selected: "003", planText: "# x", layout: "stack" }));
  const sideBody = find(side, (n) => n.key === KEYS.body);
  const stackBody = find(stacked, (n) => n.key === KEYS.body);
  assert.equal(sideBody.direction, "row");
  assert.equal(stackBody.direction, "column");
  assert.equal(stackBody.align, "stretch");
  assert.deepEqual(stackBody.children.map((n) => n.key), [KEYS.tasksPane, KEYS.detail]);
  assert.equal(find(stacked, (n) => n.key === KEYS.detail).style.height, "fill");
  // The toggle names what it switches to.
  const toSide = find(stacked, (n) => n.action === ACTIONS.layout);
  const toStack = find(side, (n) => n.action === ACTIONS.layout);
  assert.deepEqual([toStack.icon, toStack.tooltip], ["list-view", "Stack the panes"]);
  assert.deepEqual([toSide.icon, toSide.tooltip], ["exchange", "Side by side"]);
  // A different layout is a different structure: a refresh replaces the UI.
  assert.notEqual(viewShape(makeState({ layout: "stack" })), viewShape(makeState()));
});

const PLAN = [
  "# Plan 007: Ship it",
  "",
  "> **Executor instructions**: follow the steps.",
  "",
  "## Status",
  "",
  "- **Priority**: P1",
  "",
  "## Why this matters",
  "",
  "Because.",
  "",
  "## Steps",
  "",
  "1. One.",
  "",
  "```sh",
  "## not a heading, inside a fence",
  "```",
  "",
  "## `Done` criteria ##",
  "",
  "- [ ] tests pass",
  "",
].join("\n");

test("planSections splits the plan on its ## headings, without the H1 and the Status section", () => {
  const sections = planSections(PLAN);
  assert.deepEqual(sections.map((s) => s.title), ["Overview", "Why this matters", "Steps", "Done criteria"]);
  assert.equal(sections[0].text, "> **Executor instructions**: follow the steps.");
  assert.equal(sections[1].text, "Because.");
  assert.equal(sections[2].text, "1. One.\n\n```sh\n## not a heading, inside a fence\n```");
  assert.equal(sections[3].text, "- [ ] tests pass");
  for (const section of sections) {
    assert.ok(!/^# Plan/m.test(section.text));
    assert.ok(!/Priority/.test(section.text));
  }
  // No text before the first heading: no Overview.
  assert.deepEqual(planSections("# Plan 1: x\n\n## A\n\na\n## B\n\nb").map((s) => s.title), ["A", "B"]);
  assert.deepEqual(planSections(""), []);
});

test("the plan pane renders one section at a time; All, first in the select, renders everything", () => {
  const base = makeState({ selected: "003", planText: PLAN });
  const markdown = (state) => walk(planScroll(state)).filter((n) => n.type === "markdown");
  // Default: the first section, alone.
  assert.deepEqual(markdown(base).map((n) => n.text), ["> **Executor instructions**: follow the steps."]);
  const steps = { ...base, section: "Steps" };
  assert.equal(markdown(steps).length, 1);
  assert.ok(markdown(steps)[0].text.startsWith("1. One."));
  const whole = { ...base, section: WHOLE_PLAN };
  assert.ok(markdown(whole).some((n) => n.text.includes("Because.")));
  assert.ok(markdown(whole).some((n) => n.text.includes("tests pass")));
  // A section that is gone falls back to the first.
  assert.equal(markdown({ ...base, section: "Gone" })[0].text, "> **Executor instructions**: follow the steps.");
  // The select: All first, then one option per section; no other whole-plan option at the end.
  const select = sectionSelect(steps);
  assert.equal(select.action, ACTIONS.section);
  assert.deepEqual(select.options.map((o) => o.label), ["All", "Overview", "Why this matters", "Steps", "Done criteria"]);
  assert.deepEqual(select.options[0], { value: ALL_SECTIONS.value, label: "All" });
  assert.equal(select.options.filter((o) => o.value === ALL_SECTIONS.value).length, 1);
  assert.ok(!select.options.some((o) => /whole plan/i.test(o.label)));
  assert.equal(select.value, sectionValue(2));
  // The default is the first real section (Overview), not All: the whole plan is the heaviest to render.
  assert.equal(sectionSelect(base).value, sectionValue(0));
  assert.equal(sectionSelect({ ...base, section: null }).value, sectionValue(0));
  // All selected: the select shows it; the scroll has one Markdown node per section, keyed by index,
  // each with its own heading line as written, nothing else between them.
  assert.equal(sectionSelect(whole).value, ALL_SECTIONS.value);
  const scroll = planScroll(whole);
  assert.deepEqual(scroll.children.map((n) => n.type), ["markdown", "markdown", "markdown", "markdown"]);
  assert.deepEqual(scroll.children.map((n) => n.key), ["plan-md-0", "plan-md-1", "plan-md-2", "plan-md-3"]);
  assert.deepEqual(
    scroll.children.map((n) => n.text),
    [
      "> **Executor instructions**: follow the steps.",
      "## Why this matters\n\nBecause.",
      "## Steps\n\n1. One.\n\n```sh\n## not a heading, inside a fence\n```",
      "## `Done` criteria ##\n\n- [ ] tests pass",
    ],
  );
  assert.deepEqual(planParts(whole), scroll.children.map((n) => ({ key: n.key, text: n.text })));
  // One section: one node, "plan-md", without its heading.
  assert.deepEqual(planParts(steps).map((p) => p.key), ["plan-md"]);
  // Option values map back to titles; All maps to the whole plan.
  assert.equal(sectionTitle(PLAN, sectionValue(1)), "Why this matters");
  assert.equal(sectionTitle(PLAN, ALL_SECTIONS.value), WHOLE_PLAN);
  assert.equal(sectionTitle(PLAN, "s99"), null);
  // A plan with its own "## All" section: that section and the All option stay apart.
  const own = makeState({ selected: "003", planText: "# Plan 003: x\n\nIntro.\n\n## All\n\nOnly this.\n" });
  const ownSelect = sectionSelect({ ...own, section: "All" });
  assert.deepEqual(ownSelect.options.map((o) => o.label), ["All", "Overview", "All"]);
  assert.equal(ownSelect.value, sectionValue(1));
  assert.equal(markdown({ ...own, section: "All" })[0].text, "Only this.");
  assert.deepEqual(markdown({ ...own, section: WHOLE_PLAN }).map((n) => n.text), ["Intro.", "## All\n\nOnly this."]);
  // The signature changes with the shown section, not with other sections' text.
  const other = { ...base, planText: PLAN.replace("Because.", "Because, really.") };
  assert.equal(planSignature(base), planSignature({ ...other }));
  assert.notEqual(planSignature(base), planSignature(steps));
  assert.notEqual(planSignature(base), planSignature({ ...base, planText: PLAN.replace("follow the steps", "read first") }));
});
