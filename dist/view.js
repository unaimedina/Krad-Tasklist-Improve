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

// src/types.ts
var TASK_STATUSES = ["TODO", "IN PROGRESS", "DONE", "BLOCKED", "REJECTED"];

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
  // show the in-tab Markdown editor form
  saveEdit: "save-edit",
  // form submit of the quick editor
  cancelEdit: "cancel-edit",
  setStatus: "set-status",
  // select change on the detail pane
  filter: "filter",
  // select change of the task list filter
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
  // Tasks page: select change to switch group
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
  // the scroll with the plan Markdown or the quick editor
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
var TITLE_LINE_CHARS = 32;
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
  const node2 = ui.flex(
    id,
    [
      hrow(
        `${id}-left`,
        [
          ui.flex(
            `${id}-lead`,
            [ui.text(`${id}-number`, id, { size: "sm", font: "mono", color: "text_muted", wrap: "no_wrap" })],
            { direction: "column", align: "center", style: { width: { fixed: 36 } } }
          ),
          vstack(`${id}-text`, [
            ui.text(`${id}-title`, line1, titleStyle),
            ui.text(`${id}-title-2`, line2 || "\xA0", titleStyle),
            ui.text(`${id}-meta`, metaLine(task) || "\xA0", { size: "xs", color: "text_muted", wrap: "no_wrap" })
          ])
        ],
        { gap: "sm" }
      ),
      ui.flex(
        `${id}-status`,
        [...isLive(run) ? [ui.spinner(`${id}-spinner`)] : [], ui.badge(`${id}-badge`, badge.text, badge.tone)],
        { direction: "row", align: "center", justify: "end", style: { gap: "xs", width: { fixed: 104 } } }
      )
    ],
    { direction: "row", align: "center", justify: "between", style: { width: "fill", padding: "sm", gap: "sm" } }
  );
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
    left.push(ui.select("header-group", ACTIONS.group, page.groups, group.value));
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
  const toolButtons = [
    iconButton("toolbar-new", ACTIONS.newTask, "add", "New task"),
    iconButton("toolbar-generate", ACTIONS.generate, "magic", "Write plans with /improve"),
    iconButton("toolbar-reconcile", ACTIONS.reconcile, "repeat", "Reconcile plans with /improve"),
    iconButton("toolbar-refresh", ACTIONS.refresh, "refresh", "Refresh")
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
  return hrow(
    KEYS.header,
    [hrow("header-left", left), hrow("header-right", right, { gap: "md" })],
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
  return hrow(KEYS.session, children, {
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
  return stack(KEYS.tasksPane, [tasksPaneHeader(state), filter, list], {
    ...PANEL,
    width: { fixed: 440 },
    padding: "md"
  });
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
function relativePath(root, file) {
  const rel = relative(root, file);
  return rel && !rel.startsWith("..") ? rel.split("\\").join("/") : file;
}
function emptyState(key, text, buttons, style) {
  const children = [
    ui.icon(`${key}-icon`, "tasks", "text_muted"),
    ui.text(`${key}-text`, text, { size: "sm", color: "text_subtle", wrap: "wrap" })
  ];
  if (buttons.length > 0) children.push(hrow(`${key}-buttons`, buttons));
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
  const actions = hrow(
    "detail-actions",
    [
      hrow("detail-buttons", [
        ...runControl,
        ui.button("detail-run-worktree", ACTIONS.runWorktree, {
          label: "Run in worktree",
          icon: "git-branch",
          variant: "secondary",
          enabled: live || starting ? "no" : "yes"
        }),
        ui.button("detail-variants", ACTIONS.variants, { label: "Compare agents", icon: "exchange", variant: "ghost" })
      ]),
      hrow(
        "detail-editors",
        [
          iconButton("detail-edit", ACTIONS.edit, "pencil", "Edit in editor"),
          iconButton("detail-quick-edit", ACTIONS.quickEdit, "note", "Quick edit")
        ],
        { gap: "xs" }
      )
    ],
    { width: "fill" },
    "between"
  );
  const statusRow = hrow("detail-status-row", [
    ui.flex("detail-status-label-box", [ui.text("detail-status-label", "Status", { size: "xs", color: "text_muted" })], {
      direction: "row",
      align: "center",
      style: { width: { fixed: 64 } }
    }),
    ui.select(
      "detail-status",
      ACTIONS.setStatus,
      TASK_STATUSES.map((status) => ({ value: status, label: status })),
      task.status
    )
  ]);
  const heading = [
    hrow("detail-eyebrow", [
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
  if (chips.length > 0) heading.push(hrow("detail-chips", chips, { gap: "sm" }));
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
function planPane(state) {
  let children;
  if (state.editing) {
    children = [
      ui.form(
        "plan-form",
        ACTIONS.saveEdit,
        [{ key: "text", label: "Plan (Markdown)", type: "text", kind: "multiline", value: state.planText ?? "" }],
        "Save"
      ),
      ui.button("detail-cancel-edit", ACTIONS.cancelEdit, { label: "Cancel", icon: "cancel", variant: "ghost" })
    ];
  } else if (state.planText === null) {
    children = [ui.text("detail-unreadable", "Cannot read the plan file.", { size: "sm", color: "text_muted" })];
  } else {
    children = [ui.markdown("plan-md", planBody(state.planText))];
  }
  return { key: KEYS.plan, type: "scroll", direction: "column", style: { height: "fill", padding: "xs", gap: "md" }, children };
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
    children.push(band(KEYS.body, [tasksPane(state), taskDetail(state)], { width: "fill", height: "fill", gap: "lg" }));
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
    state.editing
  ].join("|");
}
export {
  ACTIONS,
  FILTERS,
  KEYS,
  TITLE_LINE_CHARS,
  busyKey,
  detailTop,
  filteredTasks,
  header,
  noGroupView,
  planBody,
  planPane,
  problemsPanel,
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
