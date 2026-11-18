import { basename, relative } from "node:path";
import type { Badge, Choice, Icon, ListRow, Node, Style } from "@krad-ade/extension";
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
  openTab: "open-tab",         // Tasks page: open the Tasklist tab of its group
  group: "group",              // Tasks page: select change to switch group
} as const;

/** Keys of the views' main nodes. */
export const KEYS = {
  root: "root",
  header: "header",
  session: "session",
  problems: "problems",
  body: "body",
  tasksPane: "tasks-pane",
  tasks: "tasks",              // the task list (ui.list, rows served by rows())
  detail: "detail",
  detailTop: "detail-top",     // the plan pane without the plan text
  plan: "detail-plan",         // the scroll with the plan Markdown or the quick editor
  tasksPaneHeader: "tasks-pane-header",
  tasksEmpty: "tasks-empty",   // the sentence that replaces an empty list
  empty: "empty",
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
  filter: Filter;             // task list filter of the view
  busy?: readonly string[];   // actions still starting: "run:<id>", "run-worktree:<id>", "run-next"
}

/** Busy keys of the actions that start an agent, while they start. */
export const busyKey = {
  run: (id: string) => `${ACTIONS.run}:${id}`,
  runWorktree: (id: string) => `${ACTIONS.runWorktree}:${id}`,
  runNext: ACTIONS.runNext as string,
};

function isBusy(state: TabState, key: string): boolean {
  return state.busy?.includes(key) ?? false;
}

const STATUS_BADGES: Record<TaskStatus, Badge> = {
  TODO: { text: "todo", tone: "neutral" },
  "IN PROGRESS": { text: "in progress", tone: "info" },
  DONE: { text: "done", tone: "success" },
  BLOCKED: { text: "blocked", tone: "error" },
  REJECTED: { text: "rejected", tone: "neutral" },
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

// Layout rules of the app's renderer (krad-ui extension_view/style.rs, krad-extension-api view/style.rs):
// - a flex's align DEFAULTS TO CENTER, not stretch: without an explicit align its children are centred on
//   the cross axis and shrunk to their content. Every container that must give its children the full
//   width (columns) or height (rows) sets align "stretch" explicitly (see `stack` and `band`); align
//   "center" is only for icon+text rows and empty states.
// - width "fill" is 100% of the parent, not a flex grow: never put it on a child of a row that has siblings.
// - height "fill" is 100% height plus flex-grow along the PARENT's main axis: in a row it takes the remaining width.
// - a select renders as a wrapping row of chips: give it its own line.
// - a list row body is the only child of the app's flex_1 row wrapper: width "fill" is safe there.

/** A column whose children take its full width. */
function stack(key: string, children: Node[], style: Style = {}): Node {
  return ui.flex(key, children, { direction: "column", align: "stretch", style: { gap: "md", ...style } });
}

/** A row whose children take its full height. */
function band(key: string, children: Node[], style: Style = {}): Node {
  return ui.flex(key, children, { direction: "row", align: "stretch", style: { gap: "md", ...style } });
}

function iconButton(key: string, action: string, icon: Icon, tooltip: string, enabled: "yes" | "no" = "yes"): Node {
  return ui.button(key, action, { icon, variant: "ghost", tooltip, enabled });
}

type Justify = "start" | "between" | "center";

function hrow(key: string, children: Node[], style: Style = {}, justify: Justify = "start"): Node {
  return ui.flex(key, children, { direction: "row", align: "center", justify, style: { gap: "sm", ...style } });
}

/** A column whose items start at the left (the renderer's default centres them). */
function vstack(key: string, children: Node[], style: Style = {}): Node {
  return ui.flex(key, children, { direction: "column", align: "start", style: { gap: "xs", ...style } });
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
  return [task.priority, task.effort, task.dependsOn.length > 0 ? `after ${task.dependsOn.join(", ")}` : null]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Characters of a list title line at text size sm (~6.8px each): the pane (440) minus its padding
 * (24), the app row padding (16), the row padding (16), the id column (36), two gaps (16) and the
 * status column (104) leave ~228px.
 */
export const TITLE_LINE_CHARS = 32;

/**
 * A task title for the list: Markdown code ticks dropped, split at word boundaries into exactly
 * two lines of at most `max` characters, the second ending in "…" when the title is longer.
 * Rows of a list must all have the same height, so a short title gets an empty second line.
 */
export function titleLines(title: string, max = TITLE_LINE_CHARS): [string, string] {
  const words = title.replace(/`/g, "").replace(/\s+/g, " ").trim().split(" ");
  const take = (limit: number): string => {
    let line = "";
    while (words.length > 0) {
      const next = line ? `${line} ${words[0]}` : words[0]!;
      if (next.length > limit) break;
      line = next;
      words.shift();
    }
    if (line === "" && words.length > 0) {
      // One word longer than the line: cut it.
      line = words[0]!.slice(0, limit);
      words[0] = words[0]!.slice(limit);
    }
    return line;
  };
  const first = take(max);
  let second = take(max);
  if (words.length > 0) {
    words.unshift(...second.split(" "));
    second = `${take(max - 1)}…`;
  }
  return [first, second];
}

/**
 * One row of the task list: key = task id. A fixed-width leading column with the id, two title
 * lines and a meta line, then a fixed-width trailing column with the one status mark (a pill),
 * preceded by a spinner while an agent works on the task. The trailing column has a fixed width so
 * the titles never move when a status or the spinner changes.
 */
export function taskRow(state: TabState, task: Task): ListRow {
  const run = runOf(state, task.id);
  const badge = statusBadge(task, run);
  const id = task.id;
  const [line1, line2] = titleLines(task.title);
  const titleStyle = { size: "sm", weight: "medium", color: "text_strong", wrap: "no_wrap" } as const;
  const node = ui.flex(
    id,
    [
      hrow(
        `${id}-left`,
        [
          ui.flex(
            `${id}-lead`,
            [ui.text(`${id}-number`, id, { size: "sm", font: "mono", color: "text_muted", wrap: "no_wrap" })],
            { direction: "column", align: "center", style: { width: { fixed: 36 } } },
          ),
          vstack(`${id}-text`, [
            ui.text(`${id}-title`, line1, titleStyle),
            ui.text(`${id}-title-2`, line2 || "\u00a0", titleStyle),
            ui.text(`${id}-meta`, metaLine(task) || "\u00a0", { size: "xs", color: "text_muted", wrap: "no_wrap" }),
          ]),
        ],
        { gap: "sm" },
      ),
      ui.flex(
        `${id}-status`,
        [...(isLive(run) ? [ui.spinner(`${id}-spinner`)] : []), ui.badge(`${id}-badge`, badge.text, badge.tone)],
        { direction: "row", align: "center", justify: "end", style: { gap: "xs", width: { fixed: 104 } } },
      ),
    ],
    { direction: "row", align: "center", justify: "between", style: { width: "fill", padding: "sm", gap: "sm" } },
  );
  return { node };
}

/** Rows start..end (end exclusive) of the task list. */
export function taskRows(state: TabState, start = 0, end = Number.MAX_SAFE_INTEGER): ListRow[] {
  return filteredTasks(state)
    .slice(start, end)
    .map((task) => taskRow(state, task));
}

// ---------------------------------------------------------------------------
// Tab and page
// ---------------------------------------------------------------------------

/**
 * What the Tasks page adds to the tab's UI: an "Open in a tab" button and, with several groups,
 * a select to switch group. `null` = the Tasklist tab.
 */
export interface PageChrome {
  groups: Choice[]; // value = group root, label = group name
}

/**
 * The header: title, scope and progress on the left; tools and the run actions on the right.
 * No filled button here: the one accent of the screen is the selected task's Run.
 */
export function header(state: TabState, page: PageChrome | null = null): Node {
  const runnable = hasTodo(state) ? "yes" : "no";
  const left: Node[] = [
    ui.icon("header-icon", "tasks", "text_subtle"),
    ui.text("header-title", "Tasklist", { size: "lg", weight: "bold", color: "text_strong", wrap: "no_wrap" }),
  ];
  const group = page?.groups.find((g) => g.value === state.set.root);
  if (page !== null && page.groups.length > 1 && group !== undefined) {
    left.push(ui.select("header-group", ACTIONS.group, page.groups, group.value));
  } else {
    left.push(
      ui.text("header-folder", basename(state.set.root) || state.set.root, {
        size: "sm",
        color: "text_muted",
        wrap: "no_wrap",
      }),
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
    iconButton("toolbar-refresh", ACTIONS.refresh, "refresh", "Refresh"),
  ];
  if (page !== null) toolButtons.push(iconButton("toolbar-open-tab", ACTIONS.openTab, "open-external", "Open in a tab"));
  const tools = hrow("header-tools", toolButtons, { padding: "xs", gap: "xs", radius: "full", border: "border" });
  const startingNext = isBusy(state, busyKey.runNext);
  const right: Node[] = [
    tools,
    ui.button("toolbar-run-next", ACTIONS.runNext, {
      label: startingNext ? "Starting…" : "Run next",
      icon: startingNext ? "loading" : "play",
      variant: "secondary",
      enabled: startingNext ? "no" : runnable,
      tooltip: "Run the next TODO task whose dependencies are done",
    }),
    state.session.active
      ? ui.button("toolbar-stop", ACTIONS.stop, { label: "Stop", icon: "stop", variant: "danger" })
      : ui.button("toolbar-auto-run", ACTIONS.autoRun, {
          label: "Auto-run",
          icon: "flash",
          variant: "secondary",
          enabled: runnable,
          tooltip: "Run every TODO task one after another",
        }),
  ];
  return hrow(
    KEYS.header,
    [hrow("header-left", left), hrow("header-right", right, { gap: "md" })],
    { width: "fill", gap: "md" },
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
  return hrow(KEYS.session, children, {
    width: "fill",
    background: "panel",
    border: "border",
    radius: "md",
    padding: "md",
  });
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
  return vstack(KEYS.problems, children, { padding: "md", border: "border", radius: "md", width: "fill" });
}

const FILTER_EMPTY: Record<Filter, string> = {
  all: "No tasks yet.",
  todo: "Nothing left to do.",
  running: "No agent is working on a task.",
  done: "No task is done yet.",
  blocked: "No task is blocked.",
};

/** "Tasks" and the count of the current view, recomputed on every filter switch. */
export function tasksPaneHeader(state: TabState): Node {
  const shown = filteredTasks(state).length;
  const total = state.set.tasks.length;
  return hrow(KEYS.tasksPaneHeader, [
    ui.text("tasks-label", "Tasks", { size: "sm", weight: "medium", color: "text_strong", wrap: "no_wrap" }),
    ui.badge("tasks-count", shown === total ? `${total}` : `${shown} of ${total}`),
  ]);
}

export function tasksPane(state: TabState): Node {
  const shown = filteredTasks(state).length;
  const filter = ui.select(
    "tasks-filter",
    ACTIONS.filter,
    FILTERS.map((value) => ({ value, label: FILTER_LABELS[value] })),
    state.filter,
  );
  // An empty view keeps the pane, its header and filter, and says so in one sentence.
  const list =
    shown > 0
      ? ui.list(KEYS.tasks, shown, "single")
      : ui.text(KEYS.tasksEmpty, FILTER_EMPTY[state.filter], { size: "sm", color: "text_muted", wrap: "wrap" });
  // Fixed width, no height "fill" (that would make it grow sideways in the body row): the body
  // row's align stretch gives it the full height; its own align stretch gives the filter and the
  // list the full width, so every row highlight spans the pane.
  return stack(KEYS.tasksPane, [tasksPaneHeader(state), filter, list], {
    ...PANEL,
    width: { fixed: 440 },
    padding: "md",
  });
}

/**
 * The plan text without its leading "# Plan NNN: ..." heading and its "## Status" section,
 * which the detail header and chips already show.
 */
export function planBody(text: string): string {
  const lines = text.replace(/^\s*#[ \t]+Plan[ \t]+\d+[^\n]*(\r?\n)?/i, "").split("\n");
  const start = lines.findIndex((line) => /^##[ \t]+Status[ \t]*\r?$/i.test(line));
  if (start !== -1) {
    let end = lines.findIndex((line, index) => index > start && /^##[ \t]/.test(line));
    if (end === -1) end = lines.length;
    lines.splice(start, end - start);
  }
  return lines.join("\n").replace(/^(\s*\r?\n)+/, "");
}

function relativePath(root: string, file: string): string {
  const rel = relative(root, file);
  return rel && !rel.startsWith("..") ? rel.split("\\").join("/") : file;
}

/** A centred empty state: icon, one line, optional buttons. */
function emptyState(key: string, text: string, buttons: Node[], style: Style): Node {
  const children: Node[] = [
    ui.icon(`${key}-icon`, "tasks", "text_muted"),
    ui.text(`${key}-text`, text, { size: "sm", color: "text_subtle", wrap: "wrap" }),
  ];
  if (buttons.length > 0) children.push(hrow(`${key}-buttons`, buttons));
  return ui.flex(key, children, {
    direction: "column",
    align: "center",
    justify: "center",
    style: { ...PANEL, padding: "xl", gap: "md", ...style },
  });
}

function selectedTask(state: TabState): Task | undefined {
  return state.selected === null ? undefined : state.set.tasks.find((t) => t.id === state.selected);
}

/**
 * The top of the plan pane: everything but the plan text. Patched alone when a run or a status
 * changes, so the plan the user is reading keeps its scroll position.
 */
export function detailTop(state: TabState, task: Task): Node {
  const run = runOf(state, task.id);
  const live = isLive(run);
  const badge = statusBadge(task, run);

  // One status mark: the status select below. A chip only for what the select cannot say.
  const chips: Node[] = [];
  if (run !== null && run.endedAt === null && badge.text !== STATUS_BADGES[task.status].text) {
    chips.push(ui.badge("detail-live", badge.text, badge.tone));
  }
  if (task.priority) chips.push(ui.badge("detail-priority", `Priority ${task.priority}`));
  if (task.effort) chips.push(ui.badge("detail-effort", `Effort ${task.effort}`));
  if (task.risk) chips.push(ui.badge("detail-risk", `Risk ${task.risk}`));
  if (task.dependsOn.length > 0) chips.push(ui.badge("detail-depends", `after ${task.dependsOn.join(", ")}`));

  const starting = isBusy(state, busyKey.run(task.id)) || isBusy(state, busyKey.runWorktree(task.id));
  const runControl: Node[] = live
    ? [
        ui.spinner("detail-running-spinner"),
        ui.text("detail-running", `Running with ${HARNESS_NAMES[run!.harness] ?? run!.harness}`, {
          size: "sm",
          color: "info",
          wrap: "no_wrap",
        }),
      ]
    : [
        ui.button("detail-run", ACTIONS.run, {
          label: starting ? "Starting…" : "Run",
          icon: starting ? "loading" : "play",
          variant: "primary",
          enabled: starting ? "no" : "yes",
        }),
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
          enabled: live || starting ? "no" : "yes",
        }),
        ui.button("detail-variants", ACTIONS.variants, { label: "Compare agents", icon: "exchange", variant: "ghost" }),
      ]),
      hrow(
        "detail-editors",
        [
          iconButton("detail-edit", ACTIONS.edit, "pencil", "Edit in editor"),
          iconButton("detail-quick-edit", ACTIONS.quickEdit, "note", "Quick edit"),
        ],
        { gap: "xs" },
      ),
    ],
    { width: "fill" },
    "between",
  );

  const statusRow = hrow("detail-status-row", [
    ui.flex("detail-status-label-box", [ui.text("detail-status-label", "Status", { size: "xs", color: "text_muted" })], {
      direction: "row",
      align: "center",
      style: { width: { fixed: 64 } },
    }),
    ui.select(
      "detail-status",
      ACTIONS.setStatus,
      TASK_STATUSES.map((status) => ({ value: status, label: status })),
      task.status,
    ),
  ]);

  const heading: Node[] = [
    hrow("detail-eyebrow", [
      ui.text("detail-plan-id", `Plan ${task.id}`, { size: "xs", weight: "medium", color: "text_muted", wrap: "no_wrap" }),
      ui.text("detail-file-path", relativePath(state.set.root, task.file), {
        size: "xs",
        font: "mono",
        color: "text_muted",
        wrap: "no_wrap",
      }),
    ]),
    ui.text("detail-title", task.title, { size: "lg", weight: "bold", color: "text_strong", wrap: "wrap" }),
  ];
  if (chips.length > 0) heading.push(hrow("detail-chips", chips, { gap: "sm" }));

  const children: Node[] = [vstack("detail-heading", heading, { gap: "sm", width: "fill" }), actions, statusRow];
  if (run !== null) {
    children.push(
      ui.details("detail-run-info", [
        { label: "Agent", value: HARNESS_NAMES[run.harness] ?? run.harness },
        { label: "Where", value: run.cwd },
        { label: "Branch", value: run.branch ?? "—" },
        { label: "State", value: run.state },
        { label: "Started", value: run.startedAt },
      ]),
    );
  }
  if (task.statusNote) {
    children.push(ui.text("detail-note", task.statusNote, { size: "sm", color: "warning", wrap: "wrap" }));
  }
  return stack(KEYS.detailTop, children);
}

/** The plan text (or the quick editor) in a scroll that takes the rest of the pane's height. */
export function planPane(state: TabState): Node {
  let children: Node[];
  if (state.editing) {
    children = [
      ui.form(
        "plan-form",
        ACTIONS.saveEdit,
        [{ key: "text", label: "Plan (Markdown)", type: "text", kind: "multiline", value: state.planText ?? "" }],
        "Save",
      ),
      ui.button("detail-cancel-edit", ACTIONS.cancelEdit, { label: "Cancel", icon: "cancel", variant: "ghost" }),
    ];
  } else if (state.planText === null) {
    children = [ui.text("detail-unreadable", "Cannot read the plan file.", { size: "sm", color: "text_muted" })];
  } else {
    children = [ui.markdown("plan-md", planBody(state.planText))];
  }
  // Style has a single padding for all sides; xs keeps the scrollbar off the text.
  return { key: KEYS.plan, type: "scroll", direction: "column", style: { height: "fill", padding: "xs", gap: "md" }, children };
}

export function taskDetail(state: TabState): Node {
  const task = selectedTask(state);
  // height "fill" inside the body row: takes the width the tasks pane leaves.
  if (task === undefined) {
    return emptyState(KEYS.detail, "Select a task to read its plan", [], { height: "fill" });
  }
  return stack(KEYS.detail, [detailTop(state, task), ui.divider("detail-divider"), planPane(state)], {
    ...PANEL,
    height: "fill",
    padding: "lg",
  });
}

/** The whole Tasklist UI, shared by the Tasklist tab (`page` null) and the Tasks page. */
export function tasklistView(state: TabState, page: PageChrome | null = null): Node {
  const children: Node[] = [header(state, page)];
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
            variant: "secondary",
          }),
          ui.button(`${KEYS.empty}-new`, ACTIONS.newTask, { label: "New task", icon: "add", variant: "secondary" }),
        ],
        { width: "fill", height: "fill" },
      ),
    );
  } else {
    children.push(band(KEYS.body, [tasksPane(state), taskDetail(state)], { width: "fill", height: "fill", gap: "lg" }));
  }
  return stack(KEYS.root, children, { width: "fill", height: "fill", padding: "lg", gap: "lg" });
}

/** A page with no group to show (the Tasks page when the workspace has no group). */
export function noGroupView(): Node {
  return stack(
    KEYS.root,
    [emptyState(KEYS.empty, "Open a group to see its tasks.", [], { width: "fill", height: "fill" })],
    { width: "fill", height: "fill", padding: "lg", gap: "lg" },
  );
}

/**
 * What decides the structure of the view: when it is unchanged, a data refresh patches the
 * changed nodes in place instead of replacing the whole UI.
 */
export function viewShape(state: TabState): string {
  const task = selectedTask(state);
  return [
    state.set.dir !== null,
    state.session.active,
    state.set.problems.length > 0,
    filteredTasks(state).length > 0,
    task?.id ?? "",
    state.editing,
  ].join("|");
}
