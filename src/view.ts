import { basename, relative } from "node:path";
import type { Badge, Choice, Icon, ListRow, Node, Style } from "@krad-ade/extension";
import { ui } from "@krad-ade/extension";
import type { Harness, PlanSet, RunRecord, Task, TaskStatus } from "./types.js";

/** Action ids sent by the views. A contract with the event handlers in main.ts: rename only together. */
export const ACTIONS = {
  run: "run",                  // row menu / button: run the task in the group folder
  runWorktree: "run-worktree", // run the task in a new git worktree
  variants: "variants",        // compare agents on this task with Krad variants
  edit: "edit",                // open the plan file in Krad's editor
  openViewer: "open-viewer",   // open the plan file in Krad, to read it in its Markdown preview
  quickEdit: "quick-edit",     // edit the plan with a prompt: an agent changes the Markdown
  setStatus: "set-status",     // "Change status" button: the app's picker chooses the status
  filter: "filter",            // select change of the task list filter
  section: "section",          // select change of the plan section shown
  layout: "layout",            // header button: side by side <-> stacked panes
  newTask: "new-task",
  refresh: "refresh",
  runNext: "run-next",
  autoRun: "auto-run",
  stop: "stop",
  generate: "generate",        // write plans with /improve
  reconcile: "reconcile",      // /improve reconcile
  openTab: "open-tab",         // Tasks page: open the Tasklist tab of its group
  group: "group",              // Tasks page: group button, the app's picker chooses the group
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
  plan: "detail-plan",         // the plan: the section select and the scroll with one section
  planSections: "plan-sections", // the section select
  planScroll: "plan-scroll",   // the scroll with the selected section's Markdown
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
  planText: string | null;    // contents of the selected plan file
  session: SessionInfo;
  filter: Filter;             // task list filter of the view
  busy?: readonly string[];   // actions still starting: "run:<id>", "run-worktree:<id>", "run-next"
  layout?: Layout;            // side by side (default) or stacked panes
  section?: string | null;    // title of the plan section shown, WHOLE_PLAN (All), or null for the first
}

/** Side by side: tasks pane left, plan right. Stacked: tasks pane on top, plan under it. */
export type Layout = "side" | "stack";

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
// - views get no width and no resize event: a narrow window is handled by rows that wrap
//   (`flow`), pickers instead of wide segmented selects, and a stacked layout the user can choose.

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

/** A row that wraps its children onto more lines when the window is narrow. */
function flow(key: string, children: Node[], style: Style = {}, justify: Justify = "start"): Node {
  return ui.flex(key, children, { direction: "row", align: "center", justify, wrap: "wrap", style: { gap: "sm", ...style } });
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

// Task list geometry. The app renders a list as a gpui uniform_list whose rows are
// div.flex.flex_row with 8px horizontal padding and NO w_full (krad-ui extension_view/collections.rs):
// each row is sized to its content, and width "fill" inside a row body resolves against that
// content-sized row and does nothing. So every row body gets the same FIXED width, derived from the
// fixed pane width, and so do its three columns: every row (and its hover and selection highlight)
// is exactly as wide as the others. Widths include padding (gpui sizes boxes border-box).
/** Width of the tasks pane side by side with the plan. Stacked, the pane takes the full width and
 * the rows keep this geometry (they are fixed-width, left-aligned). */
export const PANE_W = 380;
/** Height of the tasks pane in the stacked layout. */
export const STACK_TASKS_H = 280;
/** Padding of the tasks pane: the "md" space token. */
export const PANE_PAD = 12;
/** Horizontal padding the app puts on each side of a list row. */
export const APP_ROW_PAD_X = 8;
/** Width of a row body: the pane's inner width minus the app's row padding (the list has none). */
export const ROW_BODY_W = PANE_W - 2 * PANE_PAD - 2 * APP_ROW_PAD_X; // 340
/** Padding of a row body: the "sm" space token, on each side. */
export const ROW_PAD = 8;
/** Gap between the row's columns: the "sm" space token. */
export const ROW_GAP = 8;
/** The id column. */
export const ROW_LEAD_W = 36;
/**
 * The status area after the text column: one pill (the widest, "in progress", is ~76px) or a
 * spinner while an agent works. Not a node of its own: the mark sits right after the fixed text
 * column, so every mark starts on the same edge.
 */
export const ROW_STATUS_W = 88;
/** The text column: what the other columns, the gaps and the padding leave. */
export const ROW_TEXT_W = ROW_BODY_W - 2 * ROW_PAD - ROW_LEAD_W - ROW_STATUS_W - 2 * ROW_GAP; // 184

/** Characters of a list title line at text size sm (~6.8px each) in the 184px text column. */
export const TITLE_LINE_CHARS = 26;

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
 * One row of the task list: key = task id. A fixed-width leading column with the id, a fixed-width
 * text column (two title lines and a meta line), then the one status mark: a pill, or a spinner
 * while an agent works on the task (the header's "N running" chip and the plan pane say it in
 * words). The body and its columns have fixed widths (ROW_BODY_W = ROW_LEAD_W + ROW_TEXT_W +
 * ROW_STATUS_W + gaps + padding), so every row has the same width and every mark starts on the
 * same edge. 8 nodes in every row: the list renders every visible row, so each node saved counts.
 */
export function taskRow(state: TabState, task: Task): ListRow {
  const run = runOf(state, task.id);
  const badge = statusBadge(task, run);
  const id = task.id;
  const [line1, line2] = titleLines(task.title);
  const titleStyle = { size: "sm", weight: "medium", color: "text_strong", wrap: "no_wrap" } as const;
  const children: Node[] = [
    ui.flex(
      `${id}-lead`,
      [ui.text(`${id}-number`, id, { size: "sm", font: "mono", color: "text_muted", wrap: "no_wrap" })],
      { direction: "column", align: "center", style: { width: { fixed: ROW_LEAD_W } } },
    ),
    vstack(
      `${id}-text`,
      [
        ui.text(`${id}-title`, line1, titleStyle),
        ui.text(`${id}-title-2`, line2 || "\u00a0", titleStyle),
        ui.text(`${id}-meta`, metaLine(task) || "\u00a0", { size: "xs", color: "text_muted", wrap: "no_wrap" }),
      ],
      { width: { fixed: ROW_TEXT_W } },
    ),
    isLive(run) ? ui.spinner(`${id}-spinner`) : ui.badge(`${id}-badge`, badge.text, badge.tone),
  ];
  const node = ui.flex(id, children, {
    direction: "row",
    align: "center",
    style: { width: { fixed: ROW_BODY_W }, padding: "sm", gap: "sm" },
  });
  return { node };
}

/** Rows start..end (end exclusive) of the task list: only those, from the state in memory. */
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
 * a button that opens the app's picker to switch group. `null` = the Tasklist tab.
 */
export interface PageChrome {
  groups: Choice[]; // value = group root, label = group name
}

/**
 * The header: title, scope and progress on the left; tools and the run actions on the right.
 * The row and its right group wrap, so a narrow window puts them on more lines instead of
 * squeezing them. No filled button here: the one accent of the screen is the selected task's Run.
 */
export function header(state: TabState, page: PageChrome | null = null): Node {
  const runnable = hasTodo(state) ? "yes" : "no";
  const left: Node[] = [
    ui.icon("header-icon", "tasks", "text_subtle"),
    ui.text("header-title", "Tasklist", { size: "lg", weight: "bold", color: "text_strong", wrap: "no_wrap" }),
  ];
  const group = page?.groups.find((g) => g.value === state.set.root);
  if (page !== null && page.groups.length > 1 && group !== undefined) {
    left.push(
      ui.button("header-group", ACTIONS.group, {
        label: group.label,
        icon: "chevron-down",
        variant: "ghost",
        tooltip: "Switch group",
      }),
    );
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
      stacked ? "Side by side" : "Stack the panes",
    ),
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
  return flow(
    KEYS.header,
    [flow("header-left", left), flow("header-right", right)],
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
  return flow(KEYS.session, children, {
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
  // Side by side: fixed width, no height "fill" (that would make it grow sideways in the body
  // row); the body row's align stretch gives it the full height. Stacked: the full width (its rows
  // are fixed-width anyway) and a fixed height, so the plan gets the rest. Its own align stretch
  // gives the filter and the list the pane's width.
  const size: Style =
    state.layout === "stack" ? { width: "fill", height: { fixed: STACK_TASKS_H } } : { width: { fixed: PANE_W } };
  return stack(KEYS.tasksPane, [tasksPaneHeader(state), filter, list], { ...PANEL, ...size, padding: "md" });
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

/** One part of a plan: the text before its first "## " heading ("Overview"), or one "## " section. */
export interface PlanSection {
  title: string;          // the heading's text, code ticks dropped
  heading: string | null; // the heading line as written ("## `Done` criteria"); null for Overview
  text: string;           // the section's Markdown without its heading line
}

/**
 * What a view remembers when it shows the whole plan (TabState.section). Not a heading's text: a
 * NUL cannot be in one, so a plan with a "## All" section still shows that section alone.
 */
export const WHOLE_PLAN = "\u0000all";
/** The section select's first option, which shows the whole plan. */
export const ALL_SECTIONS = { value: "all", label: "All" } as const;
const OVERVIEW = "Overview";

/**
 * The plan body (planBody) split on its "## " headings. Big Markdown is what costs the renderer
 * the most, so the plan pane renders one section at a time. "## " lines inside fenced code blocks
 * are not headings. An empty overview is left out.
 */
export function planSections(text: string): PlanSection[] {
  const sections: PlanSection[] = [];
  let title = OVERVIEW;
  let headingLine: string | null = null;
  let lines: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const body = lines.join("\n").replace(/^(\s*\r?\n)+/, "").replace(/\s+$/, "");
    if (body || headingLine !== null) sections.push({ title, heading: headingLine, text: body });
  };
  for (const line of planBody(text).split("\n")) {
    const marker = /^[ \t]*(```|~~~)/.exec(line)?.[1];
    if (marker) fence = fence === null ? marker : fence === marker ? null : fence;
    const heading = fence === null && !marker ? /^##[ \t]+(.+?)[ \t#]*\r?$/.exec(line) : null;
    if (heading) {
      flush();
      title = heading[1]!.replace(/`/g, "").trim();
      headingLine = line.replace(/\s+$/, "");
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * The section a view shows: the whole plan if it chose All, the section it chose if the plan still
 * has it, else the first (the default: the whole plan is the heaviest Markdown to render).
 */
function shownSection(state: TabState, sections: PlanSection[]): PlanSection | null {
  if (state.section === WHOLE_PLAN && state.planText !== null) {
    return { title: WHOLE_PLAN, heading: null, text: planBody(state.planText) };
  }
  return sections.find((s) => s.title === state.section) ?? sections[0] ?? null;
}

/** One Markdown node of the plan scroll: its key and its text. */
export interface PlanPart {
  key: string;
  text: string;
}

/** Key of the one Markdown node of the plan scroll. */
export const PLAN_MD = "plan-md";

/**
 * The Markdown the plan scroll shows: one section's text without its heading (the select names
 * it), or with All the whole plan (planBody: no H1, no ## Status). A file that cannot be read or a
 * section with no text says so in Markdown too, so the scroll's content is always one Markdown node.
 */
export function planMarkdown(state: TabState): string {
  if (state.planText === null) return "_Cannot read the plan file._";
  if (state.section === WHOLE_PLAN) return planBody(state.planText) || "_Nothing written here yet._";
  const shown = shownSection(state, planSections(state.planText));
  return shown === null || shown.text === "" ? "_Nothing written here yet._" : shown.text;
}

/**
 * The Markdown nodes of the plan scroll: always exactly one. Krad renders a column scroll whose
 * only child is one Markdown node as a natively scrolling, lazily laid-out text view (like Notes);
 * a scroll with several children only gets caching. So the whole plan is one node too, and a data
 * refresh replaces that one node when its text changed.
 */
export function planParts(state: TabState): PlanPart[] {
  return [{ key: PLAN_MD, text: planMarkdown(state) }];
}

/** The node of one plan part. */
export function planPartNode(part: PlanPart): Node {
  return ui.markdown(part.key, part.text);
}

/**
 * The plan pane's outline: the section titles and the one shown. While it is unchanged, a data
 * refresh only replaces the plan parts whose text changed; otherwise it replaces the plan pane.
 */
export function planOutline(state: TabState): string {
  if (state.planText === null) return "";
  const sections = planSections(state.planText);
  const shown = shownSection(state, sections);
  return JSON.stringify([sections.map((s) => s.title), shown?.title ?? ""]);
}

/** Option value of section i (titles may repeat, values may not). */
export function sectionValue(index: number): string {
  return `s${index}`;
}

/** The section title an option value of the section select stands for, or null. */
export function sectionTitle(planText: string | null, value: string): string | null {
  if (value === ALL_SECTIONS.value) return WHOLE_PLAN;
  const index = /^s(\d+)$/.exec(value)?.[1];
  if (index === undefined || planText === null) return null;
  return planSections(planText)[Number(index)]?.title ?? null;
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
  if (buttons.length > 0) children.push(flow(`${key}-buttons`, buttons, {}, "center"));
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

  // A chip for a live state ("running", "needs you"): the status row shows the plan's status.
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
  // One row that wraps: on a narrow pane the buttons go to a second line, nothing overlaps.
  const actions = flow("detail-actions", [
    ...runControl,
    ui.button("detail-run-worktree", ACTIONS.runWorktree, {
      label: "Run in worktree",
      icon: "git-branch",
      variant: "secondary",
      enabled: live || starting ? "no" : "yes",
    }),
    ui.button("detail-variants", ACTIONS.variants, { label: "Compare agents", icon: "exchange", variant: "ghost" }),
    iconButton("detail-edit", ACTIONS.edit, "note", "Edit in editor"),
    iconButton("detail-open-viewer", ACTIONS.openViewer, "open-external", "Open in Krad's viewer"),
    iconButton("detail-quick-edit", ACTIONS.quickEdit, "magic", "Edit with a prompt"),
  ]);

  // The status as one pill and a button to the app's picker: a five-option select wraps badly.
  const plan = STATUS_BADGES[task.status];
  const statusRow = flow("detail-status-row", [
    ui.text("detail-status-label", "Status", { size: "xs", color: "text_muted", wrap: "no_wrap" }),
    ui.badge("detail-status-badge", plan.text, plan.tone),
    ui.button("detail-status", ACTIONS.setStatus, { label: "Change status", icon: "pencil", variant: "ghost" }),
  ]);

  const heading: Node[] = [
    flow("detail-eyebrow", [
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
  if (chips.length > 0) heading.push(flow("detail-chips", chips));

  const children: Node[] = [vstack("detail-heading", heading, { gap: "sm", width: "fill" }), actions, statusRow];
  if (run !== null) {
    children.push(
      ui.details("detail-run-info", [
        { label: "Agent", value: HARNESS_NAMES[run.harness] ?? run.harness },
        { label: "Where", value: run.cwd },
        { label: "Branch", value: run.branch ?? "—" },
        { label: "State", value: run.state },
        { label: "Terminal", value: String(run.terminal) },
        { label: "Started", value: run.startedAt },
      ]),
    );
  }
  if (task.statusNote) {
    children.push(ui.text("detail-note", task.statusNote, { size: "sm", color: "warning", wrap: "wrap" }));
  }
  return stack(KEYS.detailTop, children);
}

/** The scroll with the shown section's Markdown: what a section switch patches. */
export function planScroll(state: TabState): Node {
  // Exactly one child, a Markdown node: Krad's fast path for long text (see planParts). Anything
  // else the plan pane shows (the section select) sits outside the scroll.
  // Style has a single padding for all sides; xs keeps the scrollbar off the text.
  return {
    key: KEYS.planScroll,
    type: "scroll",
    direction: "column",
    style: { height: "fill", padding: "xs" },
    children: planParts(state).map(planPartNode),
  };
}

/** The section select: "All" first, then one chip per section. Null for a plan of one section. */
export function sectionSelect(state: TabState): Node | null {
  if (state.planText === null) return null;
  const sections = planSections(state.planText);
  if (sections.length < 2) return null;
  const shown = shownSection(state, sections);
  const options: Choice[] = [
    { ...ALL_SECTIONS },
    ...sections.map((s, index) => ({ value: sectionValue(index), label: s.title })),
  ];
  const index = sections.findIndex((s) => s.title === shown?.title);
  const value = shown?.title === WHOLE_PLAN ? ALL_SECTIONS.value : sectionValue(Math.max(0, index));
  return ui.select(KEYS.planSections, ACTIONS.section, options, value);
}

/** The plan: the section select over the scroll with one section, taking the pane's remaining height. */
export function planPane(state: TabState): Node {
  const select = sectionSelect(state);
  return stack(KEYS.plan, select === null ? [planScroll(state)] : [select, planScroll(state)], {
    height: "fill",
    gap: "sm",
  });
}

/**
 * What the plan pane shows, as a string: a data refresh re-sends the plan only when this changed
 * (the section list or the shown section's text), never for a change elsewhere in the plan set.
 */
export function planSignature(state: TabState): string {
  if (state.planText === null) return "";
  return JSON.stringify([planOutline(state), planParts(state)]);
}

export function taskDetail(state: TabState): Node {
  const task = selectedTask(state);
  // height "fill": side by side it takes the width the tasks pane leaves; stacked, the height.
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
    const panes = [tasksPane(state), taskDetail(state)];
    const style: Style = { width: "fill", height: "fill", gap: "lg" };
    children.push(state.layout === "stack" ? stack(KEYS.body, panes, style) : band(KEYS.body, panes, style));
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
    state.layout ?? "side",
  ].join("|");
}
