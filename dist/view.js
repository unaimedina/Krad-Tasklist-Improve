// src/view.ts
import { basename, relative } from "node:path";

// node_modules/@krad-ade/extension/dist/view.js
function node(type, key, fields) {
  return { key, type, ...fields };
}
var ui = {
  flex: (key, children, options = {}) => node("flex", key, { ...options, children }),
  row: (key, children, style = {}) => node("flex", key, { direction: "row", style, children }),
  column: (key, children, style = {}) => node("flex", key, { direction: "column", align: "stretch", style, children }),
  stack: (key, children, style = {}) => node("stack", key, { style, children }),
  grid: (key, columns, children, style = {}) => node("grid", key, { columns, style, children }),
  scroll: (key, children, direction = "column") => node("scroll", key, { direction, children }),
  text: (key, text, style = {}) => node("text", key, { text, style }),
  markdown: (key, text) => node("markdown", key, { text }),
  icon: (key, icon, color) => node("icon", key, { icon, color: color ?? null }),
  image: (key, source, width = "auto", height = "auto") => node("image", key, { source, width, height }),
  badge: (key, text, tone = "neutral") => node("badge", key, { text, tone }),
  spinner: (key) => node("spinner", key, {}),
  divider: (key) => node("divider", key, {}),
  button: (key, action, options = {}) => node("button", key, { action, ...options }),
  input: (key, action, options = {}) => node("input", key, { action, ...options }),
  toggle: (key, action, value, label) => node("toggle", key, { action, value, label: label ?? null }),
  select: (key, action, options, value) => node("select", key, { action, options, value: value ?? null }),
  slider: (key, action, options) => node("slider", key, { action, ...options }),
  list: (key, count, selection = "none") => node("list", key, { count, selection }),
  tree: (key, items) => node("tree", key, { items }),
  table: (key, columns, count, sort) => node("table", key, { columns, count, sort: sort ?? null }),
  form: (key, submit, fields, submitLabel) => node("form", key, { submit, fields, submit_label: submitLabel ?? null }),
  details: (key, entries) => node("details", key, { entries }),
  stream: (key, lines = [], maxLines) => node("stream", key, maxLines === void 0 ? { lines } : { lines, max_lines: maxLines }),
  terminal: (key, terminal) => node("terminal", key, { terminal })
};

// node_modules/@krad-ade/extension/dist/framing.js
var MAX_FRAME_BYTES = 64 * 1024 * 1024;

// src/view.ts
var ACTIONS = {
  run: "run",
  // row menu / button: run the task in the group folder
  runWorktree: "run-worktree",
  // run the task in a new git worktree
  variants: "variants",
  // compare agents on this task with Krad variants
  edit: "edit",
  // open the plan file in Krad's editor
  quickEdit: "quick-edit",
  // edit the plan with a prompt: an agent changes the Markdown
  setStatus: "set-status",
  // "Change status" button: the app's picker chooses the status
  filter: "filter",
  // select change of the task list filter
  section: "section",
  // select change of the plan section shown
  layout: "layout",
  // header button: side by side <-> stacked panes
  newTask: "new-task",
  refresh: "refresh",
  runNext: "run-next",
  autoRun: "auto-run",
  stop: "stop",
  generate: "generate",
  // write plans with /improve
  reconcile: "reconcile",
  // /improve reconcile
  openTab: "open-tab",
  // Tasks page: open the Tasklist tab of its group
  group: "group"
  // Tasks page: group button, the app's picker chooses the group
};
var KEYS = {
  root: "root",
  header: "header",
  session: "session",
  problems: "problems",
  body: "body",
  tasksPane: "tasks-pane",
  tasks: "tasks",
  // the task list (ui.list, rows served by rows())
  detail: "detail",
  detailTop: "detail-top",
  // the plan pane without the plan text
  plan: "detail-plan",
  // the plan: the section select and the scroll with one section
  planSections: "plan-sections",
  // the section select
  planScroll: "plan-scroll",
  // the scroll with the selected section's Markdown
  tasksPaneHeader: "tasks-pane-header",
  tasksEmpty: "tasks-empty",
  // the sentence that replaces an empty list
  empty: "empty"
};
var FILTERS = ["all", "todo", "running", "done", "blocked"];
var FILTER_LABELS = {
  all: "All",
  todo: "To do",
  running: "Running",
  done: "Done",
  blocked: "Blocked"
};
var busyKey = {
  run: (id) => `${ACTIONS.run}:${id}`,
  runWorktree: (id) => `${ACTIONS.runWorktree}:${id}`,
  runNext: ACTIONS.runNext
};
function isBusy(state, key) {
  return state.busy?.includes(key) ?? false;
}
var STATUS_BADGES = {
  TODO: { text: "todo", tone: "neutral" },
  "IN PROGRESS": { text: "in progress", tone: "info" },
  DONE: { text: "done", tone: "success" },
  BLOCKED: { text: "blocked", tone: "error" },
  REJECTED: { text: "rejected", tone: "neutral" }
};
var HARNESS_NAMES = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode"
};
var LIVE_STATES = /* @__PURE__ */ new Set(["starting", "working", "idle", "unknown"]);
var PANEL = { background: "panel", border: "border", radius: "lg" };
function runOf(state, taskId) {
  return state.runs.find((run) => run.taskId === taskId) ?? null;
}
function isLive(run) {
  return run !== null && run.endedAt === null && LIVE_STATES.has(run.state);
}
function hasTodo(state) {
  return state.set.tasks.some((task) => task.status === "TODO");
}
function statusBadge(task, run) {
  if (run !== null && run.endedAt === null) {
    if (LIVE_STATES.has(run.state)) return { text: "running", tone: "info" };
    if (run.state === "waiting-for-input") return { text: "needs you", tone: "warning" };
  }
  return STATUS_BADGES[task.status];
}
function stack(key, children, style = {}) {
  return ui.flex(key, children, { direction: "column", align: "stretch", style: { gap: "md", ...style } });
}
function band(key, children, style = {}) {
  return ui.flex(key, children, { direction: "row", align: "stretch", style: { gap: "md", ...style } });
}
function iconButton(key, action, icon, tooltip, enabled = "yes") {
  return ui.button(key, action, { icon, variant: "ghost", tooltip, enabled });
}
function hrow(key, children, style = {}, justify = "start") {
  return ui.flex(key, children, { direction: "row", align: "center", justify, style: { gap: "sm", ...style } });
}
function flow(key, children, style = {}, justify = "start") {
  return ui.flex(key, children, { direction: "row", align: "center", justify, wrap: "wrap", style: { gap: "sm", ...style } });
}
function vstack(key, children, style = {}) {
  return ui.flex(key, children, { direction: "column", align: "start", style: { gap: "xs", ...style } });
}
function counts(state) {
  const tasks = state.set.tasks;
  return {
    done: tasks.filter((task) => task.status === "DONE").length,
    total: tasks.length,
    running: tasks.filter((task) => isLive(runOf(state, task.id))).length,
    blocked: tasks.filter((task) => task.status === "BLOCKED").length
  };
}
function doneChip(key, state) {
  const { done, total } = counts(state);
  return ui.badge(key, `${done}/${total} done`, total > 0 && done === total ? "success" : "neutral");
}
function filteredTasks(state) {
  const tasks = state.set.tasks;
  switch (state.filter) {
    case "todo":
      return tasks.filter((task) => task.status === "TODO");
    case "running":
      return tasks.filter((task) => isLive(runOf(state, task.id)) || task.status === "IN PROGRESS");
    case "done":
      return tasks.filter((task) => task.status === "DONE");
    case "blocked":
      return tasks.filter((task) => task.status === "BLOCKED");
    default:
      return tasks;
  }
}
function metaLine(task) {
  return [task.priority, task.effort, task.dependsOn.length > 0 ? `after ${task.dependsOn.join(", ")}` : null].filter(Boolean).join(" \xB7 ");
}
var PANE_W = 380;
var STACK_TASKS_H = 280;
var PANE_PAD = 12;
var APP_ROW_PAD_X = 8;
var ROW_BODY_W = PANE_W - 2 * PANE_PAD - 2 * APP_ROW_PAD_X;
var ROW_PAD = 8;
var ROW_GAP = 8;
var ROW_LEAD_W = 36;
var ROW_STATUS_W = 88;
var ROW_TEXT_W = ROW_BODY_W - 2 * ROW_PAD - ROW_LEAD_W - ROW_STATUS_W - 2 * ROW_GAP;
var TITLE_LINE_CHARS = 26;
function titleLines(title, max = TITLE_LINE_CHARS) {
  const words = title.replace(/`/g, "").replace(/\s+/g, " ").trim().split(" ");
  const take = (limit) => {
    let line = "";
    while (words.length > 0) {
      const next = line ? `${line} ${words[0]}` : words[0];
      if (next.length > limit) break;
      line = next;
      words.shift();
    }
    if (line === "" && words.length > 0) {
      line = words[0].slice(0, limit);
      words[0] = words[0].slice(limit);
    }
    return line;
  };
  const first = take(max);
  let second = take(max);
  if (words.length > 0) {
    words.unshift(...second.split(" "));
    second = `${take(max - 1)}\u2026`;
  }
  return [first, second];
}
function taskRow(state, task) {
  const run = runOf(state, task.id);
  const badge = statusBadge(task, run);
  const id = task.id;
  const [line1, line2] = titleLines(task.title);
  const titleStyle = { size: "sm", weight: "medium", color: "text_strong", wrap: "no_wrap" };
  const children = [
    ui.flex(
      `${id}-lead`,
      [ui.text(`${id}-number`, id, { size: "sm", font: "mono", color: "text_muted", wrap: "no_wrap" })],
      { direction: "column", align: "center", style: { width: { fixed: ROW_LEAD_W } } }
    ),
    vstack(
      `${id}-text`,
      [
        ui.text(`${id}-title`, line1, titleStyle),
        ui.text(`${id}-title-2`, line2 || "\xA0", titleStyle),
        ui.text(`${id}-meta`, metaLine(task) || "\xA0", { size: "xs", color: "text_muted", wrap: "no_wrap" })
      ],
      { width: { fixed: ROW_TEXT_W } }
    ),
    isLive(run) ? ui.spinner(`${id}-spinner`) : ui.badge(`${id}-badge`, badge.text, badge.tone)
  ];
  const node2 = ui.flex(id, children, {
    direction: "row",
    align: "center",
    style: { width: { fixed: ROW_BODY_W }, padding: "sm", gap: "sm" }
  });
  return { node: node2 };
}
function taskRows(state, start = 0, end = Number.MAX_SAFE_INTEGER) {
  return filteredTasks(state).slice(start, end).map((task) => taskRow(state, task));
}
function header(state, page = null) {
  const runnable = hasTodo(state) ? "yes" : "no";
  const left = [
    ui.icon("header-icon", "tasks", "text_subtle"),
    ui.text("header-title", "Tasklist", { size: "lg", weight: "bold", color: "text_strong", wrap: "no_wrap" })
  ];
  const group = page?.groups.find((g) => g.value === state.set.root);
  if (page !== null && page.groups.length > 1 && group !== void 0) {
    left.push(
      ui.button("header-group", ACTIONS.group, {
        label: group.label,
        icon: "chevron-down",
        variant: "ghost",
        tooltip: "Switch group"
      })
    );
  } else {
    left.push(
      ui.text("header-folder", basename(state.set.root) || state.set.root, {
        size: "sm",
        color: "text_muted",
        wrap: "no_wrap"
      })
    );
  }
  if (state.set.dir !== null) {
    const { running, blocked } = counts(state);
    left.push(doneChip("header-done", state));
    if (running > 0) left.push(ui.badge("header-running", `${running} running`, "info"));
    if (blocked > 0) left.push(ui.badge("header-blocked", `${blocked} blocked`, "error"));
  }
  const stacked = state.layout === "stack";
  const toolButtons = [
    iconButton("toolbar-new", ACTIONS.newTask, "add", "New task"),
    iconButton("toolbar-generate", ACTIONS.generate, "magic", "Write plans with /improve"),
    iconButton("toolbar-reconcile", ACTIONS.reconcile, "repeat", "Reconcile plans with /improve"),
    iconButton("toolbar-refresh", ACTIONS.refresh, "refresh", "Refresh"),
    iconButton(
      "toolbar-layout",
      ACTIONS.layout,
      stacked ? "exchange" : "list-view",
      stacked ? "Side by side" : "Stack the panes"
    )
  ];
  if (page !== null) toolButtons.push(iconButton("toolbar-open-tab", ACTIONS.openTab, "open-external", "Open in a tab"));
  const tools = hrow("header-tools", toolButtons, { padding: "xs", gap: "xs", radius: "full", border: "border" });
  const startingNext = isBusy(state, busyKey.runNext);
  const right = [
    tools,
    ui.button("toolbar-run-next", ACTIONS.runNext, {
      label: startingNext ? "Starting\u2026" : "Run next",
      icon: startingNext ? "loading" : "play",
      variant: "secondary",
      enabled: startingNext ? "no" : runnable,
      tooltip: "Run the next TODO task whose dependencies are done"
    }),
    state.session.active ? ui.button("toolbar-stop", ACTIONS.stop, { label: "Stop", icon: "stop", variant: "danger" }) : ui.button("toolbar-auto-run", ACTIONS.autoRun, {
      label: "Auto-run",
      icon: "flash",
      variant: "secondary",
      enabled: runnable,
      tooltip: "Run every TODO task one after another"
    })
  ];
  return flow(
    KEYS.header,
    [flow("header-left", left), flow("header-right", right)],
    { width: "fill", gap: "md" },
    "between"
  );
}
function sessionStrip(state) {
  const { session } = state;
  const parts = [`Auto-run \xB7 ${session.done} of ${session.total} done`];
  if (session.running > 0) parts.push(`${session.running} running`);
  const children = [
    ui.spinner("session-spinner"),
    ui.text("session-text", parts.join(" \xB7 "), { size: "sm", color: "text_default", wrap: "no_wrap" })
  ];
  if (session.message) {
    children.push(ui.text("session-message", session.message, { size: "sm", color: "text_muted", wrap: "wrap" }));
  }
  return flow(KEYS.session, children, {
    width: "fill",
    background: "panel",
    border: "border",
    radius: "md",
    padding: "md"
  });
}
var PROBLEMS_SHOWN = 3;
function problemsPanel(problems) {
  const children = problems.slice(0, PROBLEMS_SHOWN).map((problem, index) => ui.text(`problem-${index}`, problem, { size: "xs", color: "warning", wrap: "wrap" }));
  if (problems.length > PROBLEMS_SHOWN) {
    children.push(
      ui.text("problems-more", `and ${problems.length - PROBLEMS_SHOWN} more`, { size: "xs", color: "text_muted" })
    );
  }
  return vstack(KEYS.problems, children, { padding: "md", border: "border", radius: "md", width: "fill" });
}
var FILTER_EMPTY = {
  all: "No tasks yet.",
  todo: "Nothing left to do.",
  running: "No agent is working on a task.",
  done: "No task is done yet.",
  blocked: "No task is blocked."
};
function tasksPaneHeader(state) {
  const shown = filteredTasks(state).length;
  const total = state.set.tasks.length;
  return hrow(KEYS.tasksPaneHeader, [
    ui.text("tasks-label", "Tasks", { size: "sm", weight: "medium", color: "text_strong", wrap: "no_wrap" }),
    ui.badge("tasks-count", shown === total ? `${total}` : `${shown} of ${total}`)
  ]);
}
function tasksPane(state) {
  const shown = filteredTasks(state).length;
  const filter = ui.select(
    "tasks-filter",
    ACTIONS.filter,
    FILTERS.map((value) => ({ value, label: FILTER_LABELS[value] })),
    state.filter
  );
  const list = shown > 0 ? ui.list(KEYS.tasks, shown, "single") : ui.text(KEYS.tasksEmpty, FILTER_EMPTY[state.filter], { size: "sm", color: "text_muted", wrap: "wrap" });
  const size = state.layout === "stack" ? { width: "fill", height: { fixed: STACK_TASKS_H } } : { width: { fixed: PANE_W } };
  return stack(KEYS.tasksPane, [tasksPaneHeader(state), filter, list], { ...PANEL, ...size, padding: "md" });
}
function planBody(text) {
  const lines = text.replace(/^\s*#[ \t]+Plan[ \t]+\d+[^\n]*(\r?\n)?/i, "").split("\n");
  const start = lines.findIndex((line) => /^##[ \t]+Status[ \t]*\r?$/i.test(line));
  if (start !== -1) {
    let end = lines.findIndex((line, index) => index > start && /^##[ \t]/.test(line));
    if (end === -1) end = lines.length;
    lines.splice(start, end - start);
  }
  return lines.join("\n").replace(/^(\s*\r?\n)+/, "");
}
var WHOLE_PLAN = "Whole plan";
var OVERVIEW = "Overview";
function planSections(text) {
  const sections = [];
  let title = OVERVIEW;
  let lines = [];
  let fence = null;
  const flush = () => {
    const body = lines.join("\n").replace(/^(\s*\r?\n)+/, "").replace(/\s+$/, "");
    if (body || title !== OVERVIEW) sections.push({ title, text: body });
  };
  for (const line of planBody(text).split("\n")) {
    const marker = /^[ \t]*(```|~~~)/.exec(line)?.[1];
    if (marker) fence = fence === null ? marker : fence === marker ? null : fence;
    const heading = fence === null && !marker ? /^##[ \t]+(.+?)[ \t#]*\r?$/.exec(line) : null;
    if (heading) {
      flush();
      title = heading[1].replace(/`/g, "").trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}
function shownSection(state, sections) {
  if (state.section === WHOLE_PLAN && state.planText !== null) return { title: WHOLE_PLAN, text: planBody(state.planText) };
  return sections.find((s) => s.title === state.section) ?? sections[0] ?? null;
}
function sectionValue(index) {
  return `s${index}`;
}
function sectionTitle(planText, value) {
  if (value === WHOLE_PLAN) return WHOLE_PLAN;
  const index = /^s(\d+)$/.exec(value)?.[1];
  if (index === void 0 || planText === null) return null;
  return planSections(planText)[Number(index)]?.title ?? null;
}
function relativePath(root, file) {
  const rel = relative(root, file);
  return rel && !rel.startsWith("..") ? rel.split("\\").join("/") : file;
}
function emptyState(key, text, buttons, style) {
  const children = [
    ui.icon(`${key}-icon`, "tasks", "text_muted"),
    ui.text(`${key}-text`, text, { size: "sm", color: "text_subtle", wrap: "wrap" })
  ];
  if (buttons.length > 0) children.push(flow(`${key}-buttons`, buttons, {}, "center"));
  return ui.flex(key, children, {
    direction: "column",
    align: "center",
    justify: "center",
    style: { ...PANEL, padding: "xl", gap: "md", ...style }
  });
}
function selectedTask(state) {
  return state.selected === null ? void 0 : state.set.tasks.find((t) => t.id === state.selected);
}
function detailTop(state, task) {
  const run = runOf(state, task.id);
  const live = isLive(run);
  const badge = statusBadge(task, run);
  const chips = [];
  if (run !== null && run.endedAt === null && badge.text !== STATUS_BADGES[task.status].text) {
    chips.push(ui.badge("detail-live", badge.text, badge.tone));
  }
  if (task.priority) chips.push(ui.badge("detail-priority", `Priority ${task.priority}`));
  if (task.effort) chips.push(ui.badge("detail-effort", `Effort ${task.effort}`));
  if (task.risk) chips.push(ui.badge("detail-risk", `Risk ${task.risk}`));
  if (task.dependsOn.length > 0) chips.push(ui.badge("detail-depends", `after ${task.dependsOn.join(", ")}`));
  const starting = isBusy(state, busyKey.run(task.id)) || isBusy(state, busyKey.runWorktree(task.id));
  const runControl = live ? [
    ui.spinner("detail-running-spinner"),
    ui.text("detail-running", `Running with ${HARNESS_NAMES[run.harness] ?? run.harness}`, {
      size: "sm",
      color: "info",
      wrap: "no_wrap"
    })
  ] : [
    ui.button("detail-run", ACTIONS.run, {
      label: starting ? "Starting\u2026" : "Run",
      icon: starting ? "loading" : "play",
      variant: "primary",
      enabled: starting ? "no" : "yes"
    })
  ];
  const actions = flow("detail-actions", [
    ...runControl,
    ui.button("detail-run-worktree", ACTIONS.runWorktree, {
      label: "Run in worktree",
      icon: "git-branch",
      variant: "secondary",
      enabled: live || starting ? "no" : "yes"
    }),
    ui.button("detail-variants", ACTIONS.variants, { label: "Compare agents", icon: "exchange", variant: "ghost" }),
    iconButton("detail-edit", ACTIONS.edit, "note", "Edit in editor"),
    iconButton("detail-quick-edit", ACTIONS.quickEdit, "magic", "Edit with a prompt")
  ]);
  const plan = STATUS_BADGES[task.status];
  const statusRow = flow("detail-status-row", [
    ui.text("detail-status-label", "Status", { size: "xs", color: "text_muted", wrap: "no_wrap" }),
    ui.badge("detail-status-badge", plan.text, plan.tone),
    ui.button("detail-status", ACTIONS.setStatus, { label: "Change status", icon: "pencil", variant: "ghost" })
  ]);
  const heading = [
    flow("detail-eyebrow", [
      ui.text("detail-plan-id", `Plan ${task.id}`, { size: "xs", weight: "medium", color: "text_muted", wrap: "no_wrap" }),
      ui.text("detail-file-path", relativePath(state.set.root, task.file), {
        size: "xs",
        font: "mono",
        color: "text_muted",
        wrap: "no_wrap"
      })
    ]),
    ui.text("detail-title", task.title, { size: "lg", weight: "bold", color: "text_strong", wrap: "wrap" })
  ];
  if (chips.length > 0) heading.push(flow("detail-chips", chips));
  const children = [vstack("detail-heading", heading, { gap: "sm", width: "fill" }), actions, statusRow];
  if (run !== null) {
    children.push(
      ui.details("detail-run-info", [
        { label: "Agent", value: HARNESS_NAMES[run.harness] ?? run.harness },
        { label: "Where", value: run.cwd },
        { label: "Branch", value: run.branch ?? "\u2014" },
        { label: "State", value: run.state },
        { label: "Started", value: run.startedAt }
      ])
    );
  }
  if (task.statusNote) {
    children.push(ui.text("detail-note", task.statusNote, { size: "sm", color: "warning", wrap: "wrap" }));
  }
  return stack(KEYS.detailTop, children);
}
function planScroll(state) {
  let child;
  if (state.planText === null) {
    child = ui.text("detail-unreadable", "Cannot read the plan file.", { size: "sm", color: "text_muted" });
  } else {
    const section = shownSection(state, planSections(state.planText));
    child = section === null || section.text === "" ? ui.text("plan-empty", "Nothing written here yet.", { size: "sm", color: "text_muted" }) : ui.markdown("plan-md", section.text);
  }
  return {
    key: KEYS.planScroll,
    type: "scroll",
    direction: "column",
    style: { height: "fill", padding: "xs" },
    children: [child]
  };
}
function sectionSelect(state) {
  if (state.planText === null) return null;
  const sections = planSections(state.planText);
  if (sections.length < 2) return null;
  const shown = shownSection(state, sections);
  const options = sections.map((s, index2) => ({ value: sectionValue(index2), label: s.title }));
  options.push({ value: WHOLE_PLAN, label: WHOLE_PLAN });
  const index = sections.findIndex((s) => s.title === shown?.title);
  const value = shown?.title === WHOLE_PLAN ? WHOLE_PLAN : sectionValue(Math.max(0, index));
  return ui.select(KEYS.planSections, ACTIONS.section, options, value);
}
function planPane(state) {
  const select = sectionSelect(state);
  return stack(KEYS.plan, select === null ? [planScroll(state)] : [select, planScroll(state)], {
    height: "fill",
    gap: "sm"
  });
}
function planSignature(state) {
  if (state.planText === null) return "";
  const sections = planSections(state.planText);
  const shown = shownSection(state, sections);
  return JSON.stringify([sections.map((s) => s.title), shown?.title ?? "", shown?.text ?? ""]);
}
function taskDetail(state) {
  const task = selectedTask(state);
  if (task === void 0) {
    return emptyState(KEYS.detail, "Select a task to read its plan", [], { height: "fill" });
  }
  return stack(KEYS.detail, [detailTop(state, task), ui.divider("detail-divider"), planPane(state)], {
    ...PANEL,
    height: "fill",
    padding: "lg"
  });
}
function tasklistView(state, page = null) {
  const children = [header(state, page)];
  if (state.session.active) children.push(sessionStrip(state));
  if (state.set.problems.length > 0) children.push(problemsPanel(state.set.problems));
  if (state.set.dir === null) {
    children.push(
      emptyState(
        KEYS.empty,
        "No plans in this folder yet. Write some with /improve or add a task.",
        [
          ui.button(`${KEYS.empty}-generate`, ACTIONS.generate, {
            label: "Write plans with /improve",
            icon: "magic",
            variant: "secondary"
          }),
          ui.button(`${KEYS.empty}-new`, ACTIONS.newTask, { label: "New task", icon: "add", variant: "secondary" })
        ],
        { width: "fill", height: "fill" }
      )
    );
  } else {
    const panes = [tasksPane(state), taskDetail(state)];
    const style = { width: "fill", height: "fill", gap: "lg" };
    children.push(state.layout === "stack" ? stack(KEYS.body, panes, style) : band(KEYS.body, panes, style));
  }
  return stack(KEYS.root, children, { width: "fill", height: "fill", padding: "lg", gap: "lg" });
}
function noGroupView() {
  return stack(
    KEYS.root,
    [emptyState(KEYS.empty, "Open a group to see its tasks.", [], { width: "fill", height: "fill" })],
    { width: "fill", height: "fill", padding: "lg", gap: "lg" }
  );
}
function viewShape(state) {
  const task = selectedTask(state);
  return [
    state.set.dir !== null,
    state.session.active,
    state.set.problems.length > 0,
    filteredTasks(state).length > 0,
    task?.id ?? "",
    state.layout ?? "side"
  ].join("|");
}
export {
  ACTIONS,
  APP_ROW_PAD_X,
  FILTERS,
  KEYS,
  PANE_PAD,
  PANE_W,
  ROW_BODY_W,
  ROW_GAP,
  ROW_LEAD_W,
  ROW_PAD,
  ROW_STATUS_W,
  ROW_TEXT_W,
  STACK_TASKS_H,
  TITLE_LINE_CHARS,
  WHOLE_PLAN,
  busyKey,
  detailTop,
  filteredTasks,
  header,
  noGroupView,
  planBody,
  planPane,
  planScroll,
  planSections,
  planSignature,
  problemsPanel,
  sectionSelect,
  sectionTitle,
  sectionValue,
  sessionStrip,
  statusBadge,
  taskDetail,
  taskRow,
  taskRows,
  tasklistView,
  tasksPane,
  tasksPaneHeader,
  titleLines,
  viewShape
};
