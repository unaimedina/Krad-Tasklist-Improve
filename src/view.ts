import type { Badge, Icon, ItemAction, Node, TreeItem } from "@krad-ade/extension";
import { ui } from "@krad-ade/extension";
import type { PlanSet, RunRecord, Task, TaskStatus } from "./types.js";
import { TASK_STATUSES } from "./types.js";

/** Action ids sent by the tab. A contract with the event handler (plan 005): rename only together. */
export const ACTIONS = {
  select: "select",            // item action on a task row
  run: "run",                  // item action / button: run the task in the group folder
  runWorktree: "run-worktree", // run the task in a new git worktree
  variants: "variants",        // compare agents on this task with Krad variants
  edit: "edit",                // open the plan file in Krad's editor
  quickEdit: "quick-edit",     // show the in-tab Markdown editor form
  saveEdit: "save-edit",       // form submit of the quick editor
  cancelEdit: "cancel-edit",
  setStatus: "set-status",     // select change on the detail pane
  newTask: "new-task",
  refresh: "refresh",
  runNext: "run-next",
  autoRun: "auto-run",
  stop: "stop",
  generate: "generate",        // write plans with /improve
  reconcile: "reconcile",      // /improve reconcile
} as const;

/** Keys of the tab's main nodes. */
export const KEYS = {
  root: "root",
  toolbar: "toolbar",
  summary: "summary",
  tasks: "tasks",
  detail: "detail",
  problems: "problems",
  session: "session",
} as const;

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

const LIVE_STATES: ReadonlySet<RunRecord["state"]> = new Set(["starting", "working", "idle", "unknown"]);

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

export function toolbar(state: TabState): Node {
  const todo = hasTodo(state) ? "yes" : "no";
  return ui.row(
    KEYS.toolbar,
    [
      ui.button("toolbar-new", ACTIONS.newTask, { label: "New task", icon: "add", variant: "secondary" }),
      ui.button("toolbar-generate", ACTIONS.generate, {
        label: "Write plans",
        icon: "magic",
        variant: "secondary",
        tooltip: "Write plans with /improve",
      }),
      ui.button("toolbar-reconcile", ACTIONS.reconcile, {
        label: "Reconcile",
        icon: "repeat",
        variant: "secondary",
        tooltip: "Check plans against the code with /improve reconcile",
      }),
      ui.button("toolbar-refresh", ACTIONS.refresh, { label: "Refresh", icon: "refresh", variant: "ghost" }),
      ui.button("toolbar-run-next", ACTIONS.runNext, {
        label: "Run next",
        icon: "play",
        variant: "primary",
        enabled: todo,
      }),
      state.session.active
        ? ui.button("toolbar-stop", ACTIONS.stop, { label: "Stop", icon: "stop", variant: "danger" })
        : ui.button("toolbar-auto-run", ACTIONS.autoRun, {
            label: "Auto-run",
            icon: "flash",
            variant: "secondary",
            enabled: todo,
            tooltip: "Run every TODO task one after another",
          }),
    ],
    { gap: "sm" },
  );
}

export function summary(state: TabState): Node {
  if (state.set.dir === null) {
    return ui.text(KEYS.summary, "No plans in this folder yet. Write some with /improve or add a task.", {
      color: "text_muted",
      wrap: "wrap",
    });
  }
  const tasks = state.set.tasks;
  const done = tasks.filter((task) => task.status === "DONE").length;
  const running = tasks.filter((task) => isLive(runOf(state, task.id))).length;
  const blocked = tasks.filter((task) => task.status === "BLOCKED").length;
  const parts = [`${done} of ${tasks.length} done`];
  if (running > 0) parts.push(`${running} running`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
  let text = parts.join(" · ");
  if (state.session.active) {
    text = `Auto-run: ${text}`;
    if (state.session.message) text = `${text} · ${state.session.message}`;
  }
  return ui.text(KEYS.summary, text, { color: "text_subtle", wrap: "wrap" });
}

function taskMenu(): ItemAction[] {
  return [
    { action: ACTIONS.run, label: "Run here", icon: "play" },
    { action: ACTIONS.runWorktree, label: "Run in a worktree", icon: "git-branch" },
    { action: ACTIONS.variants, label: "Compare agents", icon: "exchange" },
    { action: ACTIONS.edit, label: "Edit in editor", icon: "pencil" },
    { action: ACTIONS.quickEdit, label: "Quick edit", icon: "note" },
  ];
}

function taskItem(task: Task, run: RunRecord | null): TreeItem {
  const actions: ItemAction[] = [{ action: ACTIONS.select, label: "Open", icon: "search" }];
  if ((task.status === "TODO" || task.status === "BLOCKED") && !isLive(run)) {
    actions.push({ action: ACTIONS.run, label: "Run", icon: "play" });
  }
  const description = [
    task.priority,
    task.effort,
    task.dependsOn.length > 0 ? `after ${task.dependsOn.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    key: task.id,
    label: `${task.id} · ${task.title}`,
    description: description || null,
    icon: STATUS_ICONS[task.status],
    badge: statusBadge(task, run),
    expansion: "leaf",
    actions,
    menu: taskMenu(),
  };
}

export function taskItems(state: TabState): TreeItem[] {
  return state.set.tasks.map((task) => taskItem(task, runOf(state, task.id)));
}

export function taskTree(state: TabState): Node {
  return ui.tree(KEYS.tasks, taskItems(state));
}

export function taskDetail(state: TabState): Node {
  const task = state.selected === null ? undefined : state.set.tasks.find((t) => t.id === state.selected);
  if (task === undefined) {
    return ui.column(KEYS.detail, [ui.text("detail-empty", "Select a task to read its plan.", { color: "text_muted" })], {
      width: "fill",
      padding: "sm",
    });
  }
  const run = runOf(state, task.id);
  const live = isLive(run) ? "no" : "yes";

  const entries = [
    { label: "Priority", value: task.priority ?? "—" },
    { label: "Effort", value: task.effort ?? "—" },
    { label: "Risk", value: task.risk ?? "—" },
    { label: "Depends on", value: task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "—" },
    { label: "File", value: task.file },
  ];
  if (run !== null) {
    entries.push(
      { label: "Agent", value: run.harness },
      { label: "Where", value: run.cwd },
      { label: "Branch", value: run.branch ?? "—" },
      { label: "State", value: run.state },
      { label: "Started", value: run.startedAt },
    );
  }

  const children: Node[] = [
    ui.text("detail-title", `${task.id} · ${task.title}`, { size: "lg", weight: "bold", wrap: "wrap" }),
    ui.select(
      "detail-status",
      ACTIONS.setStatus,
      TASK_STATUSES.map((status) => ({ value: status, label: status })),
      task.status,
    ),
    ui.details("detail-info", entries),
    ui.row(
      "detail-buttons",
      [
        ui.button("detail-run", ACTIONS.run, { label: "Run", icon: "play", variant: "primary", enabled: live }),
        ui.button("detail-run-worktree", ACTIONS.runWorktree, {
          label: "Run in worktree",
          icon: "git-branch",
          variant: "secondary",
          enabled: live,
        }),
        ui.button("detail-variants", ACTIONS.variants, {
          label: "Compare agents",
          icon: "exchange",
          variant: "secondary",
        }),
        ui.button("detail-edit", ACTIONS.edit, { label: "Edit in editor", icon: "pencil", variant: "ghost" }),
        ui.button("detail-quick-edit", ACTIONS.quickEdit, { label: "Quick edit", icon: "note", variant: "ghost" }),
      ],
      { gap: "sm" },
    ),
  ];
  if (task.statusNote) {
    children.push(ui.text("detail-note", task.statusNote, { color: "warning", wrap: "wrap" }));
  }
  if (state.editing) {
    children.push(
      ui.form(
        "plan-form",
        ACTIONS.saveEdit,
        [{ key: "text", label: "Plan (Markdown)", type: "text", kind: "multiline", value: state.planText ?? "" }],
        "Save",
      ),
      ui.button("detail-cancel-edit", ACTIONS.cancelEdit, { label: "Cancel", icon: "cancel", variant: "ghost" }),
    );
  } else {
    children.push(ui.scroll("detail-plan", [ui.markdown("plan-md", state.planText ?? "")]));
  }
  return ui.column(KEYS.detail, children, { gap: "sm", width: "fill" });
}

export function tasklistView(state: TabState): Node {
  const children: Node[] = [toolbar(state), summary(state)];
  if (state.set.problems.length > 0) {
    children.push(
      ui.column(
        KEYS.problems,
        state.set.problems.map((problem, index) =>
          ui.text(`problem-${index}`, problem, { color: "warning", wrap: "wrap" }),
        ),
        { gap: "xs" },
      ),
    );
  }
  children.push(
    ui.row(
      "body",
      [ui.column("tasks-pane", [taskTree(state)], { width: { fixed: 420 } }), taskDetail(state)],
      { gap: "md", height: "fill" },
    ),
  );
  return ui.column(KEYS.root, children, { gap: "md", padding: "md" });
}
