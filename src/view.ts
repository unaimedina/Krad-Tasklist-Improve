import { basename, relative } from "node:path";
import type { Badge, ColorToken, Icon, ItemAction, ListRow, Node, Style, Tone } from "@krad-ade/extension";
import { ui } from "@krad-ade/extension";
import type { Harness, PlanSet, RunRecord, Task, TaskStatus } from "./types.js";
import { TASK_STATUSES } from "./types.js";

/** Action ids sent by the views. A contract with the event handlers in main.ts: rename only together. */
export const ACTIONS = {
  run: "run",                  // row menu / button: run the task in the group folder
  runWorktree: "run-worktree", // run the task in a new git worktree
  variants: "variants",        // compare agents on this task with Krad variants
  edit: "edit",                // open the plan file in Krad's editor
  quickEdit: "quick-edit",     // show the in-tab Markdown editor form
  saveEdit: "save-edit",       // form submit of the quick editor
  cancelEdit: "cancel-edit",
  setStatus: "set-status",     // select change on the detail pane
  filter: "filter",            // select change of the task list filter
  newTask: "new-task",
  refresh: "refresh",
  runNext: "run-next",
  autoRun: "auto-run",
  stop: "stop",
  generate: "generate",        // write plans with /improve
  reconcile: "reconcile",      // /improve reconcile
  openTab: "open-tab",         // sidebar: open the Tasklist tab
} as const;

/** Keys of the views' main nodes. */
export const KEYS = {
  root: "root",
  header: "header",
  session: "session",
  problems: "problems",
  body: "body",
  tasksPane: "tasks-pane",
  tasks: "tasks",              // the tab's task list (ui.list, rows served by rows())
  detail: "detail",
  empty: "empty",
  sidebarTasks: "sidebar-tasks", // the sidebar's task list
} as const;

export const FILTERS = ["all", "todo", "running", "done", "blocked"] as const;
export type Filter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  todo: "To do",
  running: "Running",
  done: "Done",
  blocked: "Blocked",
};

export interface SessionInfo {
  active: boolean;
  done: number;
  total: number;
  running: number;
  message: string | null;
}

export interface TabState {
  set: PlanSet;
  runs: RunRecord[];          // runs of this root, latest per task first
  selected: string | null;    // task id
  editing: boolean;           // quick editor open for the selected task
  planText: string | null;    // contents of the selected plan file
  session: SessionInfo;
  filter: Filter;             // task list filter of the tab
}

const STATUS_ICONS: Record<TaskStatus, Icon> = {
  TODO: "note",
  "IN PROGRESS": "loading",
  DONE: "check",
  BLOCKED: "flag",
  REJECTED: "close",
};

const STATUS_BADGES: Record<TaskStatus, Badge> = {
  TODO: { text: "todo", tone: "neutral" },
  "IN PROGRESS": { text: "in progress", tone: "info" },
  DONE: { text: "done", tone: "success" },
  BLOCKED: { text: "blocked", tone: "error" },
  REJECTED: { text: "rejected", tone: "neutral" },
};

const TONE_COLORS: Record<Tone, ColorToken> = {
  neutral: "text_muted",
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
};

const HARNESS_NAMES: Record<Harness, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode",
};

const LIVE_STATES: ReadonlySet<RunRecord["state"]> = new Set(["starting", "working", "idle", "unknown"]);

/** A bordered panel, the ADE's surface for panes. */
const PANEL: Style = { background: "panel", border: "border", radius: "lg" };

/** The latest run of a task (runs are ordered latest first), or null. */
function runOf(state: TabState, taskId: string): RunRecord | null {
  return state.runs.find((run) => run.taskId === taskId) ?? null;
}

function isLive(run: RunRecord | null): boolean {
  return run !== null && run.endedAt === null && LIVE_STATES.has(run.state);
}

function hasTodo(state: TabState): boolean {
  return state.set.tasks.some((task) => task.status === "TODO");
}

export function statusBadge(task: Task, run: RunRecord | null): Badge {
  if (run !== null && run.endedAt === null) {
    if (LIVE_STATES.has(run.state)) return { text: "running", tone: "info" };
    if (run.state === "waiting-for-input") return { text: "needs you", tone: "warning" };
  }
  return STATUS_BADGES[task.status];
}

/** Small muted section label, e.g. TASKS. */
function label(key: string, text: string): Node {
  return ui.text(key, text, { size: "xs", weight: "medium", color: "text_muted", wrap: "no_wrap" });
}

function iconButton(key: string, action: string, icon: Icon, tooltip: string, enabled: "yes" | "no" = "yes"): Node {
  return ui.button(key, action, { icon, variant: "ghost", tooltip, enabled });
}

function hrow(key: string, children: Node[], style: Style = {}, justify: "start" | "between" | "center" = "start"): Node {
  return ui.flex(key, children, { direction: "row", align: "center", justify, style: { gap: "sm", ...style } });
}

function counts(state: TabState): { done: number; total: number; running: number; blocked: number } {
  const tasks = state.set.tasks;
  return {
    done: tasks.filter((task) => task.status === "DONE").length,
    total: tasks.length,
    running: tasks.filter((task) => isLive(runOf(state, task.id))).length,
    blocked: tasks.filter((task) => task.status === "BLOCKED").length,
  };
}

function doneChip(key: string, state: TabState): Node {
  const { done, total } = counts(state);
  return ui.badge(key, `${done}/${total} done`, total > 0 && done === total ? "success" : "neutral");
}

/** The tasks the tab's list shows, in id order. */
export function filteredTasks(state: TabState): Task[] {
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

function metaLine(task: Task): string {
  return [
    task.id,
    task.priority,
    task.effort,
    task.dependsOn.length > 0 ? `after ${task.dependsOn.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function statusIcon(key: string, task: Task, badge: Badge): Node {
  return ui.icon(key, STATUS_ICONS[task.status], TONE_COLORS[badge.tone ?? "neutral"]);
}

export function taskMenu(): ItemAction[] {
  return [
    { action: ACTIONS.run, label: "Run", icon: "play" },
    { action: ACTIONS.runWorktree, label: "Run in worktree", icon: "git-branch" },
    { action: ACTIONS.variants, label: "Compare agents", icon: "exchange" },
    { action: ACTIONS.edit, label: "Edit in editor", icon: "pencil" },
    { action: ACTIONS.quickEdit, label: "Quick edit", icon: "note" },
  ];
}

/** One row of the tab's task list: key = task id, two uniform lines. */
export function taskRow(state: TabState, task: Task): ListRow {
  const badge = statusBadge(task, runOf(state, task.id));
  const id = task.id;
  const node = hrow(
    id,
    [
      statusIcon(`${id}-icon`, task, badge),
      ui.flex(
        `${id}-text`,
        [
          ui.text(`${id}-title`, task.title, { size: "sm", weight: "medium", color: "text_strong", wrap: "no_wrap" }),
          ui.text(`${id}-meta`, metaLine(task), { size: "xs", color: "text_muted", wrap: "no_wrap" }),
        ],
        { direction: "column", style: { width: "fill" } },
      ),
      ui.badge(`${id}-badge`, badge.text, badge.tone),
    ],
    { width: "fill", padding: "xs" },
  );
  return { node, menu: taskMenu() };
}

/** Rows start..end (end exclusive) of the tab's task list. */
export function taskRows(state: TabState, start = 0, end = Number.MAX_SAFE_INTEGER): ListRow[] {
  return filteredTasks(state)
    .slice(start, end)
    .map((task) => taskRow(state, task));
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

export function header(state: TabState): Node {
  const runnable = hasTodo(state) ? "yes" : "no";
  const left: Node[] = [
    ui.icon("header-icon", "tasks", "text_subtle"),
    ui.text("header-title", "Tasklist", { size: "md", weight: "medium", color: "text_strong", wrap: "no_wrap" }),
    ui.text("header-folder", basename(state.set.root) || state.set.root, {
      size: "sm",
      color: "text_muted",
      wrap: "no_wrap",
    }),
  ];
  if (state.set.dir !== null) {
    const { running, blocked } = counts(state);
    left.push(doneChip("header-done", state));
    if (running > 0) left.push(ui.badge("header-running", `${running} running`, "info"));
    if (blocked > 0) left.push(ui.badge("header-blocked", `${blocked} blocked`, "error"));
  }
  const right: Node[] = [
    iconButton("toolbar-new", ACTIONS.newTask, "add", "New task"),
    iconButton("toolbar-generate", ACTIONS.generate, "magic", "Write plans with /improve"),
    iconButton("toolbar-reconcile", ACTIONS.reconcile, "repeat", "Reconcile plans with /improve"),
    iconButton("toolbar-refresh", ACTIONS.refresh, "refresh", "Refresh"),
    ui.button("toolbar-run-next", ACTIONS.runNext, {
      label: "Run next",
      icon: "play",
      variant: "secondary",
      enabled: runnable,
      tooltip: "Run the next TODO task whose dependencies are done",
    }),
    state.session.active
      ? ui.button("toolbar-stop", ACTIONS.stop, { label: "Stop", icon: "stop", variant: "danger" })
      : ui.button("toolbar-auto-run", ACTIONS.autoRun, {
          label: "Auto-run",
          icon: "flash",
          variant: "primary",
          enabled: runnable,
          tooltip: "Run every TODO task one after another",
        }),
  ];
  return hrow(
    KEYS.header,
    [hrow("header-left", left), hrow("header-right", right, { gap: "xs" })],
    { width: "fill", height: { fixed: 38 } },
    "between",
  );
}

export function sessionStrip(state: TabState): Node {
  const { session } = state;
  const parts = [`Auto-run · ${session.done} of ${session.total} done`];
  if (session.running > 0) parts.push(`${session.running} running`);
  const children: Node[] = [
    ui.spinner("session-spinner"),
    ui.text("session-text", parts.join(" · "), { size: "sm", color: "text_default", wrap: "no_wrap" }),
  ];
  if (session.message) {
    children.push(ui.text("session-message", session.message, { size: "sm", color: "text_muted", wrap: "wrap" }));
  }
  return hrow(KEYS.session, children, { background: "panel", border: "border", radius: "md", padding: "sm" });
}

const PROBLEMS_SHOWN = 3;

export function problemsPanel(problems: string[]): Node {
  const children = problems
    .slice(0, PROBLEMS_SHOWN)
    .map((problem, index) => ui.text(`problem-${index}`, problem, { size: "xs", color: "warning", wrap: "wrap" }));
  if (problems.length > PROBLEMS_SHOWN) {
    children.push(
      ui.text("problems-more", `and ${problems.length - PROBLEMS_SHOWN} more`, { size: "xs", color: "text_muted" }),
    );
  }
  return ui.column(KEYS.problems, children, { gap: "xs", padding: "sm", border: "border", radius: "md", width: "fill" });
}

export function tasksPane(state: TabState): Node {
  const filter = ui.select(
    "tasks-filter",
    ACTIONS.filter,
    FILTERS.map((value) => ({ value, label: FILTER_LABELS[value] })),
    state.filter,
  );
  return ui.column(
    KEYS.tasksPane,
    [
      hrow("tasks-pane-header", [label("tasks-label", "TASKS"), filter], { width: "fill" }, "between"),
      ui.list(KEYS.tasks, filteredTasks(state).length, "single"),
    ],
    { ...PANEL, width: { fixed: 360 }, height: "fill", padding: "sm", gap: "sm" },
  );
}

/** The plan text without its first "# Plan NNN: ..." heading, which the detail header already shows. */
export function planBody(text: string): string {
  return text.replace(/^\s*#[ \t]+Plan[ \t]+\d+[^\n]*(\r?\n)?/i, "").replace(/^\s*\n/, "");
}

function relativePath(root: string, file: string): string {
  const rel = relative(root, file);
  return rel && !rel.startsWith("..") ? rel.split("\\").join("/") : file;
}

function scroll(key: string, children: Node[]): Node {
  return { key, type: "scroll", direction: "column", style: { width: "fill", height: "fill", gap: "sm" }, children };
}

export function taskDetail(state: TabState): Node {
  const task = state.selected === null ? undefined : state.set.tasks.find((t) => t.id === state.selected);
  if (task === undefined) {
    return ui.flex(
      KEYS.detail,
      [
        ui.icon("detail-empty-icon", "tasks", "text_muted"),
        ui.text("detail-empty", "Select a task to read its plan", { size: "sm", color: "text_subtle" }),
      ],
      {
        direction: "column",
        align: "center",
        justify: "center",
        style: { ...PANEL, width: "fill", height: "fill", padding: "md", gap: "sm" },
      },
    );
  }
  const run = runOf(state, task.id);
  const live = isLive(run);
  const badge = statusBadge(task, run);

  const chips: Node[] = [ui.badge("detail-status-badge", badge.text, badge.tone)];
  if (task.priority) chips.push(ui.badge("detail-priority", `Priority ${task.priority}`));
  if (task.effort) chips.push(ui.badge("detail-effort", `Effort ${task.effort}`));
  if (task.risk) chips.push(ui.badge("detail-risk", `Risk ${task.risk}`));
  if (task.dependsOn.length > 0) chips.push(ui.badge("detail-depends", `after ${task.dependsOn.join(", ")}`));

  const runControl: Node[] = live
    ? [
        ui.spinner("detail-running-spinner"),
        ui.text("detail-running", `Running with ${HARNESS_NAMES[run!.harness] ?? run!.harness}`, {
          size: "sm",
          color: "info",
          wrap: "no_wrap",
        }),
      ]
    : [ui.button("detail-run", ACTIONS.run, { label: "Run", icon: "play", variant: "primary" })];
  const actions = hrow(
    "detail-actions",
    [
      hrow("detail-buttons", [
        ...runControl,
        ui.button("detail-run-worktree", ACTIONS.runWorktree, {
          label: "Run in worktree",
          icon: "git-branch",
          variant: "secondary",
          enabled: live ? "no" : "yes",
        }),
        ui.button("detail-variants", ACTIONS.variants, { label: "Compare agents", icon: "exchange", variant: "ghost" }),
        iconButton("detail-edit", ACTIONS.edit, "pencil", "Edit in editor"),
        iconButton("detail-quick-edit", ACTIONS.quickEdit, "note", "Quick edit"),
      ]),
      ui.select(
        "detail-status",
        ACTIONS.setStatus,
        TASK_STATUSES.map((status) => ({ value: status, label: status })),
        task.status,
      ),
    ],
    { width: "fill" },
    "between",
  );

  const entries = [{ label: "File", value: relativePath(state.set.root, task.file) }];
  if (run !== null) {
    entries.push(
      { label: "Agent", value: HARNESS_NAMES[run.harness] ?? run.harness },
      { label: "Where", value: run.cwd },
      { label: "Branch", value: run.branch ?? "—" },
      { label: "State", value: run.state },
      { label: "Started", value: run.startedAt },
    );
  }

  const children: Node[] = [
    ui.column(
      "detail-heading",
      [
        ui.text("detail-plan-id", `Plan ${task.id}`, { size: "xs", color: "text_muted" }),
        ui.text("detail-title", task.title, { size: "lg", weight: "bold", color: "text_strong", wrap: "wrap" }),
      ],
      { gap: "xs" },
    ),
    hrow("detail-chips", chips, { gap: "xs" }),
    actions,
    ui.details("detail-info", entries),
  ];
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
          "Save",
        ),
        ui.button("detail-cancel-edit", ACTIONS.cancelEdit, { label: "Cancel", icon: "cancel", variant: "ghost" }),
      ]),
    );
  } else if (state.planText === null) {
    children.push(ui.text("detail-unreadable", "Cannot read the plan file.", { size: "sm", color: "text_muted" }));
  } else {
    children.push(scroll("detail-plan", [ui.markdown("plan-md", planBody(state.planText))]));
  }
  return ui.column(KEYS.detail, children, { ...PANEL, width: "fill", height: "fill", padding: "md", gap: "sm" });
}

function noPlans(key: string): Node {
  return ui.flex(
    key,
    [
      ui.icon(`${key}-icon`, "tasks", "text_muted"),
      ui.text(`${key}-text`, "No plans in this folder yet. Write some with /improve or add a task.", {
        size: "sm",
        color: "text_subtle",
        wrap: "wrap",
      }),
      hrow(`${key}-buttons`, [
        ui.button(`${key}-generate`, ACTIONS.generate, {
          label: "Write plans with /improve",
          icon: "magic",
          variant: "secondary",
        }),
        ui.button(`${key}-new`, ACTIONS.newTask, { label: "New task", icon: "add", variant: "secondary" }),
      ]),
    ],
    {
      direction: "column",
      align: "center",
      justify: "center",
      style: { ...PANEL, width: "fill", height: "fill", padding: "md", gap: "md" },
    },
  );
}

export function tasklistView(state: TabState): Node {
  const children: Node[] = [header(state)];
  if (state.session.active) children.push(sessionStrip(state));
  if (state.set.problems.length > 0) children.push(problemsPanel(state.set.problems));
  if (state.set.dir === null) {
    children.push(noPlans(KEYS.empty));
  } else {
    children.push(
      ui.flex(KEYS.body, [tasksPane(state), taskDetail(state)], {
        direction: "row",
        align: "stretch",
        style: { width: "fill", height: "fill", gap: "md" },
      }),
    );
  }
  return ui.column(KEYS.root, children, { width: "fill", height: "fill", padding: "md", gap: "md" });
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

/** One row of the sidebar's task list: key = task id, one line. */
export function sidebarRow(state: TabState, task: Task): ListRow {
  const badge = statusBadge(task, runOf(state, task.id));
  const id = task.id;
  const node = hrow(
    id,
    [
      hrow(`${id}-left`, [
        statusIcon(`${id}-icon`, task, badge),
        ui.text(`${id}-id`, id, { size: "xs", color: "text_muted", wrap: "no_wrap" }),
        ui.text(`${id}-title`, task.title, { size: "sm", color: "text_default", wrap: "no_wrap" }),
      ]),
      ui.badge(`${id}-badge`, badge.text, badge.tone),
    ],
    { width: "fill" },
    "between",
  );
  return { node };
}

export function sidebarRows(state: TabState, start = 0, end = Number.MAX_SAFE_INTEGER): ListRow[] {
  return state.set.tasks.slice(start, end).map((task) => sidebarRow(state, task));
}

/**
 * The "Tasks" sidebar view: a compact list and an entry point to the Tasklist tab.
 * `state` is null when no group is open.
 */
export function sidebarView(state: TabState | null): Node {
  const left: Node[] = [label("sidebar-label", "TASKS")];
  if (state !== null && state.set.dir !== null) left.push(doneChip("sidebar-done", state));
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
          iconButton("sidebar-refresh", ACTIONS.refresh, "refresh", "Refresh"),
        ],
        { gap: "xs" },
      ),
    ],
    { width: "fill", height: { fixed: 28 } },
    "between",
  );
  const children: Node[] = [head];
  if (state === null) {
    children.push(ui.text("sidebar-empty", "Open a group to see its tasks.", { size: "sm", color: "text_muted", wrap: "wrap" }));
  } else if (state.set.dir === null) {
    children.push(
      ui.text("sidebar-empty", "No plans in this folder yet.", { size: "sm", color: "text_muted", wrap: "wrap" }),
      ui.button("sidebar-generate", ACTIONS.generate, {
        label: "Write plans with /improve",
        icon: "magic",
        variant: "ghost",
      }),
    );
  } else {
    children.push(ui.list(KEYS.sidebarTasks, state.set.tasks.length, "single"));
  }
  return ui.column(KEYS.root, children, { width: "fill", height: "fill", padding: "sm", gap: "sm" });
}
