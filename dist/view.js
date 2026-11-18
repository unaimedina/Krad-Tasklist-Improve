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
  openTab: "open-tab"
  // sidebar: open the Tasklist tab
};
var KEYS = {
  root: "root",
  header: "header",
  session: "session",
  problems: "problems",
  body: "body",
  tasksPane: "tasks-pane",
  tasks: "tasks",
  // the tab's task list (ui.list, rows served by rows())
  detail: "detail",
  empty: "empty",
  sidebarTasks: "sidebar-tasks"
  // the sidebar's task list
};
var FILTERS = ["all", "todo", "running", "done", "blocked"];
var FILTER_LABELS = {
  all: "All",
  todo: "To do",
  running: "Running",
  done: "Done",
  blocked: "Blocked"
};
var STATUS_ICONS = {
  TODO: "note",
  "IN PROGRESS": "loading",
  DONE: "check",
  BLOCKED: "flag",
  REJECTED: "close"
};
var STATUS_BADGES = {
  TODO: { text: "todo", tone: "neutral" },
  "IN PROGRESS": { text: "in progress", tone: "info" },
  DONE: { text: "done", tone: "success" },
  BLOCKED: { text: "blocked", tone: "error" },
  REJECTED: { text: "rejected", tone: "neutral" }
};
var TONE_COLORS = {
  neutral: "text_muted",
  info: "info",
  success: "success",
  warning: "warning",
  error: "error"
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
  return [
    task.id,
    task.priority,
    task.effort,
    task.dependsOn.length > 0 ? `after ${task.dependsOn.join(", ")}` : null
  ].filter(Boolean).join(" \xB7 ");
}
function statusIcon(key, task, badge) {
  return ui.icon(key, STATUS_ICONS[task.status], TONE_COLORS[badge.tone ?? "neutral"]);
}
function taskRow(state, task) {
  const badge = statusBadge(task, runOf(state, task.id));
  const id = task.id;
  const node2 = hrow(
    id,
    [
      hrow(
        `${id}-left`,
        [
          statusIcon(`${id}-icon`, task, badge),
          vstack(`${id}-text`, [
            ui.text(`${id}-title`, task.title, { size: "sm", weight: "medium", color: "text_strong", wrap: "no_wrap" }),
            ui.text(`${id}-meta`, metaLine(task), { size: "xs", color: "text_muted", wrap: "no_wrap" })
          ])
        ],
        { gap: "md" }
      ),
      ui.badge(`${id}-badge`, badge.text, badge.tone)
    ],
    { width: "fill", padding: "sm", gap: "md" },
    "between"
  );
  return { node: node2 };
}
function taskRows(state, start = 0, end = Number.MAX_SAFE_INTEGER) {
  return filteredTasks(state).slice(start, end).map((task) => taskRow(state, task));
}
function header(state) {
  const runnable = hasTodo(state) ? "yes" : "no";
  const left = [
    ui.icon("header-icon", "tasks", "text_subtle"),
    ui.text("header-title", "Tasklist", { size: "lg", weight: "bold", color: "text_strong", wrap: "no_wrap" }),
    ui.text("header-folder", basename(state.set.root) || state.set.root, {
      size: "sm",
      color: "text_muted",
      wrap: "no_wrap"
    })
  ];
  if (state.set.dir !== null) {
    const { running, blocked } = counts(state);
    left.push(doneChip("header-done", state));
    if (running > 0) left.push(ui.badge("header-running", `${running} running`, "info"));
    if (blocked > 0) left.push(ui.badge("header-blocked", `${blocked} blocked`, "error"));
  }
  const tools = hrow(
    "header-tools",
    [
      iconButton("toolbar-new", ACTIONS.newTask, "add", "New task"),
      iconButton("toolbar-generate", ACTIONS.generate, "magic", "Write plans with /improve"),
      iconButton("toolbar-reconcile", ACTIONS.reconcile, "repeat", "Reconcile plans with /improve"),
      iconButton("toolbar-refresh", ACTIONS.refresh, "refresh", "Refresh")
    ],
    { padding: "xs", gap: "xs", radius: "full", border: "border" }
  );
  const right = [
    tools,
    ui.button("toolbar-run-next", ACTIONS.runNext, {
      label: "Run next",
      icon: "play",
      variant: "secondary",
      enabled: runnable,
      tooltip: "Run the next TODO task whose dependencies are done"
    }),
    state.session.active ? ui.button("toolbar-stop", ACTIONS.stop, { label: "Stop", icon: "stop", variant: "danger" }) : ui.button("toolbar-auto-run", ACTIONS.autoRun, {
      label: "Auto-run",
      icon: "flash",
      variant: "primary",
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
function tasksPane(state) {
  const shown = filteredTasks(state).length;
  const total = state.set.tasks.length;
  const filter = ui.select(
    "tasks-filter",
    ACTIONS.filter,
    FILTERS.map((value) => ({ value, label: FILTER_LABELS[value] })),
    state.filter
  );
  return ui.flex(
    KEYS.tasksPane,
    [
      hrow("tasks-pane-header", [
        ui.text("tasks-label", "Tasks", { size: "sm", weight: "medium", color: "text_strong", wrap: "no_wrap" }),
        ui.badge("tasks-count", shown === total ? `${total}` : `${shown} of ${total}`)
      ]),
      filter,
      ui.list(KEYS.tasks, shown, "single")
    ],
    {
      direction: "column",
      align: "stretch",
      style: { ...PANEL, width: { fixed: 380 }, padding: "md", gap: "md" }
    }
  );
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
function scroll(key, children) {
  return { key, type: "scroll", direction: "column", style: { height: "fill", padding: "xs", gap: "md" }, children };
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
function taskDetail(state) {
  const task = state.selected === null ? void 0 : state.set.tasks.find((t) => t.id === state.selected);
  if (task === void 0) {
    return emptyState(KEYS.detail, "Select a task to read its plan", [], { height: "fill" });
  }
  const run = runOf(state, task.id);
  const live = isLive(run);
  const badge = statusBadge(task, run);
  const chips = [ui.badge("detail-status-badge", badge.text, badge.tone)];
  if (task.priority) chips.push(ui.badge("detail-priority", `Priority ${task.priority}`));
  if (task.effort) chips.push(ui.badge("detail-effort", `Effort ${task.effort}`));
  if (task.risk) chips.push(ui.badge("detail-risk", `Risk ${task.risk}`));
  if (task.dependsOn.length > 0) chips.push(ui.badge("detail-depends", `after ${task.dependsOn.join(", ")}`));
  const runControl = live ? [
    ui.spinner("detail-running-spinner"),
    ui.text("detail-running", `Running with ${HARNESS_NAMES[run.harness] ?? run.harness}`, {
      size: "sm",
      color: "info",
      wrap: "no_wrap"
    })
  ] : [ui.button("detail-run", ACTIONS.run, { label: "Run", icon: "play", variant: "primary" })];
  const actions = hrow(
    "detail-actions",
    [
      hrow("detail-buttons", [
        ...runControl,
        ui.button("detail-run-worktree", ACTIONS.runWorktree, {
          label: "Run in worktree",
          icon: "git-branch",
          variant: "secondary",
          enabled: live ? "no" : "yes"
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
  const statusRow = hrow(
    "detail-status-row",
    [
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
    ],
    {}
  );
  const children = [
    vstack(
      "detail-heading",
      [
        ui.text("detail-plan-id", `PLAN ${task.id}`, { size: "xs", weight: "medium", color: "text_muted" }),
        ui.text("detail-title", task.title, { size: "lg", weight: "bold", color: "text_strong", wrap: "wrap" }),
        hrow("detail-chips", chips, { gap: "sm" })
      ],
      { gap: "sm", width: "fill" }
    ),
    actions,
    statusRow,
    hrow("detail-file", [
      ui.icon("detail-file-icon", "file", "text_subtle"),
      ui.text("detail-file-path", relativePath(state.set.root, task.file), {
        size: "xs",
        font: "mono",
        color: "text_subtle",
        wrap: "no_wrap"
      })
    ])
  ];
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
  children.push(ui.divider("detail-divider"));
  if (state.editing) {
    children.push(
      scroll("detail-plan", [
        ui.form(
          "plan-form",
          ACTIONS.saveEdit,
          [{ key: "text", label: "Plan (Markdown)", type: "text", kind: "multiline", value: state.planText ?? "" }],
          "Save"
        ),
        ui.button("detail-cancel-edit", ACTIONS.cancelEdit, { label: "Cancel", icon: "cancel", variant: "ghost" })
      ])
    );
  } else if (state.planText === null) {
    children.push(ui.text("detail-unreadable", "Cannot read the plan file.", { size: "sm", color: "text_muted" }));
  } else {
    children.push(scroll("detail-plan", [ui.markdown("plan-md", planBody(state.planText))]));
  }
  return ui.flex(KEYS.detail, children, {
    direction: "column",
    align: "stretch",
    style: { ...PANEL, height: "fill", padding: "lg", gap: "md" }
  });
}
function tasklistView(state) {
  const children = [header(state)];
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
    children.push(
      ui.flex(KEYS.body, [tasksPane(state), taskDetail(state)], {
        direction: "row",
        align: "stretch",
        style: { width: "fill", height: "fill", gap: "lg" }
      })
    );
  }
  return ui.flex(KEYS.root, children, {
    direction: "column",
    align: "stretch",
    style: { width: "fill", height: "fill", padding: "lg", gap: "lg" }
  });
}
function sidebarRow(state, task) {
  const badge = statusBadge(task, runOf(state, task.id));
  const id = task.id;
  const node2 = hrow(
    id,
    [
      hrow(`${id}-left`, [
        statusIcon(`${id}-icon`, task, badge),
        ui.text(`${id}-id`, id, { size: "xs", font: "mono", color: "text_muted", wrap: "no_wrap" }),
        ui.text(`${id}-title`, task.title, { size: "sm", color: "text_default", wrap: "no_wrap" })
      ]),
      ui.badge(`${id}-badge`, badge.text, badge.tone)
    ],
    { width: "fill", padding: "xs", gap: "md" },
    "between"
  );
  return { node: node2 };
}
function sidebarRows(state, start = 0, end = Number.MAX_SAFE_INTEGER) {
  return state.set.tasks.slice(start, end).map((task) => sidebarRow(state, task));
}
function sidebarView(state) {
  const left = [
    ui.text("sidebar-label", "Tasks", { size: "sm", weight: "medium", color: "text_strong", wrap: "no_wrap" })
  ];
  if (state !== null && state.set.dir !== null) {
    const { done, total } = counts(state);
    left.push(ui.badge("sidebar-done", `${done}/${total}`, total > 0 && done === total ? "success" : "neutral"));
  }
  const runnable = state !== null && hasTodo(state) ? "yes" : "no";
  const head = hrow(
    "sidebar-header",
    [
      hrow("sidebar-header-left", left),
      hrow(
        "sidebar-header-right",
        [
          iconButton("sidebar-open", ACTIONS.openTab, "open-external", "Open Tasklist"),
          iconButton("sidebar-run-next", ACTIONS.runNext, "play", "Run next", runnable),
          iconButton("sidebar-refresh", ACTIONS.refresh, "refresh", "Refresh")
        ],
        { gap: "xs" }
      )
    ],
    { width: "fill" },
    "between"
  );
  const children = [head];
  if (state === null) {
    children.push(ui.text("sidebar-empty", "Open a group to see its tasks.", { size: "sm", color: "text_muted", wrap: "wrap" }));
  } else if (state.set.dir === null) {
    children.push(
      ui.text("sidebar-empty", "No plans in this folder yet.", { size: "sm", color: "text_muted", wrap: "wrap" }),
      ui.button("sidebar-generate", ACTIONS.generate, {
        label: "Write plans with /improve",
        icon: "magic",
        variant: "ghost"
      })
    );
  } else {
    children.push(ui.list(KEYS.sidebarTasks, state.set.tasks.length, "single"));
  }
  return ui.flex(KEYS.root, children, {
    direction: "column",
    align: "stretch",
    style: { width: "fill", height: "fill", padding: "md", gap: "md" }
  });
}
export {
  ACTIONS,
  FILTERS,
  KEYS,
  filteredTasks,
  header,
  planBody,
  problemsPanel,
  sessionStrip,
  sidebarRow,
  sidebarRows,
  sidebarView,
  statusBadge,
  taskDetail,
  taskRow,
  taskRows,
  tasklistView,
  tasksPane
};
