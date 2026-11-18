import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { CallToolResult, CommandTarget, Context, Patch, RowsParams, RowsResult, SettingsValues, ViewEvent } from "@krad-ade/extension";
import { createExtension, patch } from "@krad-ade/extension";
import { createTask, findPlansDir, loadPlanSet, runnableTasks, writeStatus } from "./plans.js";
import type { AgentInfo, ExecutionStyle, KradCli } from "./runner.js";
import {
  AgentWatcher,
  createWorktree,
  findKrad,
  harnessCommand,
  improvePrompt,
  isGitRepo,
  taskPrompt,
  variantsCommand,
} from "./runner.js";
import { hasStopped, isLive, nextLaunches, sessionOver, verdictFor } from "./scheduler.js";
import type { Harness, PlanSet, RunMode, RunRecord, Task, TaskStatus } from "./types.js";
import { HARNESSES, TASK_STATUSES } from "./types.js";
import type { Filter, SessionInfo, TabState } from "./view.js";
import {
  ACTIONS,
  FILTERS,
  filteredTasks,
  KEYS,
  sidebarRows,
  sidebarView,
  taskDetail,
  taskRows,
  tasklistView,
} from "./view.js";

const run = promisify(execFile);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface Options {
  harness: Harness;
  style: ExecutionStyle;
  extraArgs: string;
  maxParallel: number;
  stopOnFailure: boolean;
  kradPath: string;
}

const DEFAULTS: Options = {
  harness: "claude",
  style: "direct",
  extraArgs: "",
  maxParallel: 1,
  stopOnFailure: true,
  kradPath: "krad",
};

function options(values: SettingsValues): Options {
  const harness = values["harness"];
  const style = values["execution-style"];
  const extraArgs = values["extra-args"];
  const maxParallel = values["max-parallel"];
  const stopOnFailure = values["stop-on-failure"];
  const kradPath = values["krad-path"];
  return {
    harness: HARNESSES.includes(harness as Harness) ? (harness as Harness) : DEFAULTS.harness,
    style: style === "direct" || style === "improve" ? style : DEFAULTS.style,
    extraArgs: typeof extraArgs === "string" ? extraArgs : DEFAULTS.extraArgs,
    maxParallel:
      typeof maxParallel === "number" && Number.isFinite(maxParallel)
        ? Math.min(8, Math.max(1, Math.round(maxParallel)))
        : DEFAULTS.maxParallel,
    stopOnFailure: typeof stopOnFailure === "boolean" ? stopOnFailure : DEFAULTS.stopOnFailure,
    kradPath: typeof kradPath === "string" && kradPath.trim() ? kradPath.trim() : DEFAULTS.kradPath,
  };
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

interface TabInfo {
  selected: string | null;
  editing: boolean;
  filter: Filter;
}

function newTab(selected: string | null = null): TabInfo {
  return { selected, editing: false, filter: "all" };
}

interface Session {
  finished: Set<string>;
  blockedOrReview: { id: string; why: "blocked" | "needs review" }[];
  done: number;
  total: number;
  token: string;
  /** Serialises advanceSession calls so two agent changes never launch the same task twice. */
  chain: Promise<void>;
}

let current: Options = DEFAULTS;
const tabs = new Map<string, TabInfo>();
const runs: RunRecord[] = [];
const sessions = new Map<string, Session>();
let watcher: AgentWatcher | null = null;
let kradCli: KradCli | null = null;
let kradMissingWarned = false;
/** Last seen bus state per terminal, to toast "waits for you" once per transition. */
const lastStates = new Map<number, string>();

function failure(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? String(error)) : String(error);
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const full = resolve(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? full.toLowerCase() : full;
  };
  return norm(a) === norm(b);
}

function isInside(path: string, folder: string): boolean {
  const rel = relative(resolve(folder), resolve(path));
  if (rel === "") return true;
  if (rel.startsWith("..") || resolve(rel) === rel) return false;
  return process.platform === "win32" ? !/^[a-zA-Z]:/.test(rel) : true;
}

function tabKey(root: string): string | undefined {
  for (const key of tabs.keys()) if (samePath(key, root)) return key;
  return undefined;
}

/** Runs of a root, latest first. */
function runsOf(root: string): RunRecord[] {
  return runs.filter((r) => samePath(r.root, root)).reverse();
}

function liveRun(root: string, taskId: string): RunRecord | undefined {
  return runs.find((r) => r.taskId === taskId && samePath(r.root, root) && isLive(r));
}

function sessionOf(root: string): Session | undefined {
  for (const [key, session] of sessions) if (samePath(key, root)) return session;
  return undefined;
}

function sessionInfo(root: string): SessionInfo {
  const session = sessionOf(root);
  const running = runsOf(root).filter(isLive).length;
  if (!session) return { active: false, done: 0, total: 0, running, message: null };
  return {
    active: true,
    done: session.done,
    total: session.total,
    running,
    message: null,
  };
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The state a view of a root renders. `withPlan` = false skips reading the selected plan file (list rows). */
function tabState(root: string, withPlan = true): TabState {
  const set = loadPlanSet(root);
  const tab = tabs.get(tabKey(root) ?? root) ?? newTab();
  const task = tab.selected === null ? undefined : set.tasks.find((t) => t.id === tab.selected);
  return {
    set,
    runs: runsOf(root),
    selected: tab.selected,
    editing: tab.editing,
    planText: withPlan && task ? readText(task.file) : null,
    session: sessionInfo(root),
    filter: tab.filter,
  };
}

function patchTab(key: string, context: Context, patches: (state: TabState) => Patch[]): void {
  try {
    context.app.patchView({ view: "tasklist", instance: key }, patches(tabState(key)));
  } catch (error) {
    context.app.log("warn", `refresh of ${key} failed: ${failure(error)}`);
  }
}

function refreshTab(root: string, context: Context): void {
  const key = tabKey(root);
  if (key !== undefined) {
    patchTab(key, context, (state) => [patch.replace(tasklistView(state)), patch.invalidate(KEYS.tasks)]);
  }
  if (sidebarRoot !== null && samePath(sidebarRoot, root)) refreshSidebar(context);
}

/** Replaces only the detail pane and re-asks the list rows (selection highlight). */
function refreshDetail(key: string, context: Context): void {
  patchTab(key, context, (state) => [patch.replace(taskDetail(state)), patch.invalidate(KEYS.tasks)]);
}

/** Re-counts and re-asks the list rows after a filter change. */
function refreshList(key: string, context: Context): void {
  patchTab(key, context, (state) => [
    patch.setCount(KEYS.tasks, filteredTasks(state).length),
    patch.invalidate(KEYS.tasks),
  ]);
}

function refreshAll(context: Context): void {
  for (const root of tabs.keys()) refreshTab(root, context);
  refreshSidebar(context);
}

// ---------------------------------------------------------------------------
// Tasks sidebar view
// ---------------------------------------------------------------------------

/** Whether the sidebar view has been rendered and not closed since. */
let sidebarOpen = false;
/** The group the sidebar view shows, from its last render. */
let sidebarRoot: string | null = null;

/** The group the sidebar shows: the first one whose folder has plans/, else the first one. */
async function sidebarGroup(context: Context): Promise<string | null> {
  const groups = (await context.app.workspaceContext()).groups;
  const withPlans = groups.find((g) => findPlansDir(g.root) !== null);
  return (withPlans ?? groups[0])?.root ?? null;
}

async function renderSidebar(context: Context): Promise<ReturnType<typeof sidebarView>> {
  sidebarRoot = await sidebarGroup(context);
  sidebarOpen = true;
  return sidebarView(sidebarRoot === null ? null : tabState(sidebarRoot));
}

function refreshSidebar(context: Context): void {
  if (!sidebarOpen) return;
  void renderSidebar(context)
    .then((node) =>
      context.app.patchView({ view: "tasks" }, [patch.replace(node), patch.invalidate(KEYS.sidebarTasks)]),
    )
    .catch((error) => context.app.log("warn", `refresh of the Tasks view failed: ${failure(error)}`));
}

/** Opens the Tasklist tab of a root, optionally with a task selected. */
async function openTab(root: string, context: Context, selected: string | null = null): Promise<void> {
  if (selected !== null) {
    const key = tabKey(root) ?? root;
    const tab = tabs.get(key);
    if (tab) {
      tab.selected = selected;
      tab.editing = false;
    } else {
      tabs.set(key, newTab(selected));
    }
  }
  await context.app.openView({ view: "tasklist", instance: tabKey(root) ?? root, title: `Tasklist · ${basename(root)}` });
  if (selected !== null) refreshTab(root, context);
}

async function onSidebarEvent(event: ViewEvent, context: Context): Promise<void> {
  try {
    const root = sidebarRoot ?? (await sidebarGroup(context));
    if (event.kind === "click") {
      switch (event.action) {
        case ACTIONS.openTab:
          if (root === null) return await withRoot(null, context, (r) => openTab(r, context));
          return await openTab(root, context);
        case ACTIONS.refresh:
          return refreshSidebar(context);
        case ACTIONS.runNext:
          if (root !== null) await runNext(root, context);
          return;
        case ACTIONS.generate:
          if (root !== null) await generate(root, context);
          return;
      }
      return;
    }
    if (event.kind === "choose" && event.node === KEYS.sidebarTasks && root !== null) {
      const id = event.items[0];
      if (id !== undefined) await openTab(root, context, id);
    }
  } catch (error) {
    context.app.toast(failure(error), "error");
  }
}

function findTask(root: string, id: string): { set: PlanSet; task: Task } | null {
  const set = loadPlanSet(root);
  const task = set.tasks.find((t) => t.id === id);
  return task ? { set, task } : null;
}

/** Path of a plan file relative to a root, with "/" separators. */
function planPathOf(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

// ---------------------------------------------------------------------------
// Command targets
// ---------------------------------------------------------------------------

async function rootFor(target: CommandTarget | null, context: Context): Promise<string | null> {
  if (target?.kind === "group") return target.root;
  const workspace = await context.app.workspaceContext();
  const groups = workspace.groups;
  const containing = (path: string): string | null => {
    let best: string | null = null;
    for (const group of groups) {
      if (isInside(path, group.root) && (best === null || group.root.length > best.length)) best = group.root;
    }
    return best;
  };
  if (target?.kind === "file") {
    // A plans folder's README.md → the folder that holds that plans folder.
    const folder = dirname(target.path);
    const parent = dirname(folder);
    if (basename(target.path).toLowerCase() === "readme.md") {
      const plans = findPlansDir(parent);
      if (plans !== null && samePath(plans, folder)) return parent;
    }
    const group = containing(target.path);
    if (group !== null) return group;
  }
  if (target?.kind === "folder") {
    if (findPlansDir(target.path) !== null) return target.path;
    const group = containing(target.path);
    if (group !== null) return group;
  }
  if (groups.length === 1) return groups[0]?.root ?? null;
  if (groups.length === 0) return null;
  const picked = await context.app.pick({
    title: "Which group?",
    items: groups.map((g) => ({ value: g.root, label: g.name, detail: g.root })),
    mode: "one",
  });
  return picked?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Running tasks
// ---------------------------------------------------------------------------

async function plansDirty(root: string): Promise<boolean> {
  try {
    const { stdout } = await run("git", ["-C", root, "status", "--porcelain", "--", "plans"], { windowsHide: true });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Starts one agent on a task. Returns true when a terminal was opened. */
async function runTask(root: string, task: Task, mode: RunMode, context: Context): Promise<boolean> {
  const { app } = context;
  if (liveRun(root, task.id)) {
    app.toast(`Task ${task.id} is already running`, "info");
    return false;
  }
  let cwd = root;
  let worktree: string | null = null;
  let branch: string | null = null;
  const previous = { status: task.status, note: task.statusNote };
  let statusWritten = false;
  try {
    if (mode === "worktree") {
      if (!(await isGitRepo(root))) {
        app.toast("Run in a worktree needs a git repository", "error");
        return false;
      }
      if (await plansDirty(root)) {
        app.toast("Uncommitted plan edits will not be in the worktree", "info");
      }
      const created = await createWorktree(root, task);
      cwd = created.path;
      worktree = created.path;
      branch = created.branch;
    }
    const planPath = planPathOf(root, task.file);
    writeStatus(loadPlanSet(root), task.id, "IN PROGRESS", null);
    statusWritten = true;
    const harness = current.harness;
    const terminal = await app.openTerminal({
      title: `task ${task.id} · ${harness}`,
      cwd,
      zone: "session",
      command: harnessCommand(harness, taskPrompt(task, planPath, current.style), current.extraArgs),
    });
    runs.push({
      taskId: task.id,
      root,
      terminal,
      harness,
      mode,
      cwd,
      worktree,
      branch,
      state: "starting",
      startedAt: new Date().toISOString(),
      endedAt: null,
    });
    await ensureWatcher(context);
    refreshTab(root, context);
    app.toast(`Started task ${task.id} with ${harness}`, "success");
    return true;
  } catch (error) {
    app.toast(`Task ${task.id} did not start: ${failure(error)}`, "error");
    if (statusWritten) {
      try {
        writeStatus(loadPlanSet(root), task.id, previous.status, previous.note);
      } catch (restoreError) {
        app.log("warn", `could not restore the status of ${task.id}: ${failure(restoreError)}`);
      }
    }
    refreshTab(root, context);
    return false;
  }
}

async function runVariants(root: string, task: Task, context: Context): Promise<void> {
  const { app } = context;
  const picked = await app.pick({
    title: "Compare agents",
    items: HARNESSES.map((h) => ({ value: h, label: h })),
    mode: "many",
  });
  if (picked === null) return;
  if (picked.length < 2 || picked.length > 4) {
    app.toast("Pick 2 to 4 agents to compare", "warning");
    return;
  }
  try {
    const harnesses = picked.filter((h): h is Harness => HARNESSES.includes(h as Harness));
    await app.openTerminal({
      title: `variants · ${task.id}`,
      cwd: root,
      zone: "utilities",
      command: variantsCommand(harnesses, taskPrompt(task, planPathOf(root, task.file), "direct")),
    });
    app.toast("Variants started — compare them in Krad's Variants view", "success");
  } catch (error) {
    app.toast(`Variants did not start: ${failure(error)}`, "error");
  }
}

async function openImprove(root: string, args: string, context: Context): Promise<void> {
  try {
    await context.app.openTerminal({
      title: "improve",
      cwd: root,
      zone: "session",
      command: harnessCommand(current.harness, improvePrompt(args), current.extraArgs),
    });
  } catch (error) {
    context.app.toast(`Could not start /improve: ${failure(error)}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Watcher and run ends
// ---------------------------------------------------------------------------

async function ensureWatcher(context: Context): Promise<void> {
  if (watcher !== null) return;
  kradCli ??= await findKrad(current.kradPath);
  if (kradCli === null) {
    if (!kradMissingWarned) {
      kradMissingWarned = true;
      context.app.toast(
        'Cannot find the krad CLI; set "Krad CLI" in the extension settings. Task states will not update by themselves — set them in the tab.',
        "warning",
      );
    }
    return;
  }
  if (watcher !== null) return;
  watcher = new AgentWatcher(
    kradCli,
    (agent) => onAgentChange(agent, context),
    (message) => context.app.log("warn", message),
  );
  watcher.start();
}

function stopWatcherIfIdle(): void {
  if (watcher === null) return;
  if (runs.some(isLive) || sessions.size > 0) return;
  watcher.stop();
  watcher = null;
}

/** The run an agent belongs to: by terminal id, else by its title while the run is still starting. */
function runForAgent(agent: AgentInfo): RunRecord | undefined {
  const byTerminal = runs.find((r) => r.terminal === agent.terminal && r.endedAt === null);
  if (byTerminal) return byTerminal;
  if (runs.some((r) => r.terminal === agent.terminal)) return undefined;
  const match = /^task (\d{3}) · /.exec(agent.title);
  if (!match) return undefined;
  const adopted = runs.find((r) => r.taskId === match[1] && r.state === "starting" && r.endedAt === null);
  if (adopted) adopted.terminal = agent.terminal;
  return adopted;
}

function onAgentChange(agent: AgentInfo, context: Context): void {
  const record = runForAgent(agent);
  if (!record) return;
  const before = lastStates.get(agent.terminal);
  lastStates.set(agent.terminal, agent.state);
  record.state = agent.state;
  if (agent.state === "waiting-for-input" && before !== "waiting-for-input") {
    context.app.toast(
      `Task ${record.taskId} waits for you in "task ${record.taskId} · ${record.harness}"`,
      "warning",
    );
  }
  if (!hasStopped(agent.state)) {
    refreshTab(record.root, context);
    return;
  }
  finishRun(record, context);
}

function finishRun(record: RunRecord, context: Context): void {
  const { app } = context;
  const root = record.root;
  let status: TaskStatus = "IN PROGRESS";
  let note: string | null = null;
  try {
    const source = record.mode === "worktree" && record.worktree ? loadPlanSet(record.worktree) : loadPlanSet(root);
    const task = source.tasks.find((t) => t.id === record.taskId);
    if (task) {
      status = task.status;
      note = task.statusNote;
    }
  } catch (error) {
    app.log("warn", `could not read the status of ${record.taskId}: ${failure(error)}`);
  }
  const verdict = verdictFor(status);
  if (record.mode === "worktree" && verdict !== "needs-review") {
    const mirrored = status === "DONE" ? [note, `in worktree ${record.branch ?? record.worktree}`].filter(Boolean).join(" — ") : note;
    try {
      writeStatus(loadPlanSet(root), record.taskId, status, mirrored || null);
    } catch (error) {
      app.log("warn", `could not mirror the status of ${record.taskId}: ${failure(error)}`);
    }
  }
  if (verdict === "needs-review") {
    app.toast(`Task ${record.taskId} stopped without updating its status — review it`, "warning");
  }
  record.endedAt = new Date().toISOString();
  const session = sessionOf(root);
  if (session) {
    session.finished.add(record.taskId);
    if (verdict === "done") session.done += 1;
    else session.blockedOrReview.push({ id: record.taskId, why: verdict === "blocked" ? "blocked" : "needs review" });
  }
  refreshTab(root, context);
  void advanceSession(root, context);
  stopWatcherIfIdle();
}

// ---------------------------------------------------------------------------
// Auto-run session
// ---------------------------------------------------------------------------

async function startAutoRun(root: string, context: Context): Promise<void> {
  const { app } = context;
  if (sessionOf(root)) {
    app.toast("An auto-run is already going in this group", "info");
    return;
  }
  const set = loadPlanSet(root);
  if (runnableTasks(set.tasks).length === 0) {
    app.toast("Nothing to run: every TODO task waits on another one", "info");
    return;
  }
  let maxParallel = current.maxParallel;
  if (maxParallel > 1 && !(await isGitRepo(root))) {
    const answer = await app.confirm({
      title: "Run one at a time?",
      detail: "Running tasks in parallel needs a git repository for the worktrees.",
      confirm: "Run one at a time",
      tone: "warning",
    });
    if (answer !== "confirmed") return;
    maxParallel = 1;
  }
  const total = set.tasks.filter((t) => t.status === "TODO").length;
  const answer = await app.confirm({
    title: `Start an auto-run of ${total} tasks with ${current.harness}, ${maxParallel} at a time?`,
    detail: "Agents will edit files in this group.",
    confirm: "Start",
    tone: "warning",
  });
  if (answer !== "confirmed") return;
  const session: Session = {
    finished: new Set(),
    blockedOrReview: [],
    done: 0,
    total,
    token: `tasklist-${root}`,
    chain: Promise.resolve(),
  };
  sessions.set(root, session);
  sessionParallel.set(session, maxParallel);
  app.progress({ token: session.token, state: "begin", title: "Tasklist auto-run" });
  app.setTitlebarItem({ item: "tasklist", active: true });
  refreshTab(root, context);
  await advanceSession(root, context);
}

/** maxParallel chosen when the session started (1 when git was missing). */
const sessionParallel = new WeakMap<Session, number>();

function endSession(root: string, context: Context, message: string, tone: "success" | "warning" | "info"): void {
  const session = sessionOf(root);
  if (!session) return;
  for (const [key, value] of sessions) if (value === session) sessions.delete(key);
  context.app.progress({ token: session.token, state: "end" });
  if (sessions.size === 0) context.app.setTitlebarItem({ item: "tasklist", active: false });
  context.app.toast(message, tone);
  refreshTab(root, context);
  stopWatcherIfIdle();
}

function advanceSession(root: string, context: Context): Promise<void> {
  const session = sessionOf(root);
  if (!session) return Promise.resolve();
  session.chain = session.chain.then(() => advanceOnce(root, session, context)).catch((error) => {
    context.app.log("error", `auto-run step failed: ${failure(error)}`);
  });
  return session.chain;
}

async function advanceOnce(root: string, session: Session, context: Context): Promise<void> {
  if (sessionOf(root) !== session) return;
  const failed = session.blockedOrReview[0];
  if (current.stopOnFailure && failed) {
    endSession(root, context, `Auto-run stopped: task ${failed.id} ${failed.why}`, "warning");
    return;
  }
  const maxParallel = sessionParallel.get(session) ?? current.maxParallel;
  const mode: RunMode = maxParallel === 1 ? "here" : "worktree";
  const launches = nextLaunches(runnableTasks(loadPlanSet(root).tasks), runsOf(root), session.finished, maxParallel);
  for (const task of launches) {
    if (sessionOf(root) !== session) return;
    const started = await runTask(root, task, mode, context);
    if (!started) {
      // Never retry a task that cannot start; count it as needing review.
      session.finished.add(task.id);
      session.blockedOrReview.push({ id: task.id, why: "needs review" });
    }
  }
  if (sessionOf(root) !== session) return;
  if (current.stopOnFailure && session.blockedOrReview[0]) {
    const first = session.blockedOrReview[0];
    endSession(root, context, `Auto-run stopped: task ${first.id} ${first.why}`, "warning");
    return;
  }
  if (sessionOver(runnableTasks(loadPlanSet(root).tasks), runsOf(root), session.finished, maxParallel)) {
    endSession(root, context, `Auto-run finished: ${session.done}/${session.total} tasks done`, "success");
    return;
  }
  context.app.progress({ token: session.token, state: "report", message: `${session.done} of ${session.total} done` });
  refreshTab(root, context);
}

async function stopAutoRun(root: string, context: Context): Promise<void> {
  if (!sessionOf(root)) {
    context.app.toast("No auto-run is going in this group", "info");
    return;
  }
  const answer = await context.app.confirm({
    title: "Stop the auto-run?",
    detail: "Agents already running keep working.",
    confirm: "Stop",
    tone: "warning",
  });
  if (answer !== "confirmed") return;
  endSession(root, context, "Auto-run stopped. Agents already running keep working.", "info");
}

async function runNext(root: string, context: Context): Promise<void> {
  const task = runnableTasks(loadPlanSet(root).tasks).find((t) => !liveRun(root, t.id));
  if (!task) {
    context.app.toast("Nothing to run: every TODO task waits on another one", "info");
    return;
  }
  await runTask(root, task, "here", context);
}

// ---------------------------------------------------------------------------
// Tab events
// ---------------------------------------------------------------------------

async function taskAction(root: string, action: string, id: string, context: Context): Promise<void> {
  const tab = tabs.get(tabKey(root) ?? root);
  const found = findTask(root, id);
  if (!found) {
    context.app.toast(`Task ${id} is not in the plans folder any more`, "warning");
    refreshTab(root, context);
    return;
  }
  const { task } = found;
  switch (action) {
    case ACTIONS.run:
      await runTask(root, task, "here", context);
      return;
    case ACTIONS.runWorktree:
      await runTask(root, task, "worktree", context);
      return;
    case ACTIONS.variants:
      await runVariants(root, task, context);
      return;
    case ACTIONS.edit:
      await context.app.openFile({ path: task.file });
      return;
    case ACTIONS.quickEdit:
      if (tab) {
        tab.selected = id;
        tab.editing = true;
      }
      refreshDetail(tabKey(root) ?? root, context);
      return;
  }
}

async function onTabEvent(event: ViewEvent, root: string, context: Context): Promise<void> {
  const key = tabKey(root) ?? root;
  let tab = tabs.get(key);
  if (!tab) {
    tab = newTab();
    tabs.set(key, tab);
  }
  const { app } = context;
  try {
    if (event.kind === "choose" && event.node === KEYS.tasks) {
      tab.selected = event.items[0] ?? null;
      tab.editing = false;
      refreshDetail(key, context);
      return;
    }
    if (event.kind === "item_action") {
      await taskAction(key, event.action, event.item, context);
      return;
    }
    if (event.kind === "click") {
      switch (event.action) {
        case ACTIONS.newTask:
          return await newTask(key, context);
        case ACTIONS.generate:
          return await generate(key, context);
        case ACTIONS.reconcile:
          return await openImprove(key, "reconcile", context);
        case ACTIONS.refresh:
          return refreshTab(key, context);
        case ACTIONS.runNext:
          return await runNext(key, context);
        case ACTIONS.autoRun:
          return await startAutoRun(key, context);
        case ACTIONS.stop:
          return await stopAutoRun(key, context);
        case ACTIONS.cancelEdit:
          tab.editing = false;
          return refreshDetail(key, context);
        case ACTIONS.run:
        case ACTIONS.runWorktree:
        case ACTIONS.variants:
        case ACTIONS.edit:
        case ACTIONS.quickEdit:
          if (tab.selected !== null) await taskAction(key, event.action, tab.selected, context);
          return;
      }
      return;
    }
    if (event.kind === "select" && event.action === ACTIONS.filter) {
      if (FILTERS.includes(event.value as Filter)) tab.filter = event.value as Filter;
      return refreshList(key, context);
    }
    if (event.kind === "select" && event.action === ACTIONS.setStatus) {
      if (tab.selected === null) return;
      const status = event.value as TaskStatus;
      if (!TASK_STATUSES.includes(status)) return;
      let note: string | null = null;
      if (status === "BLOCKED" || status === "REJECTED") {
        note = await app.input({ title: "Reason (one line)" });
        if (note === null) return refreshTab(key, context);
        note = note.trim() || null;
      }
      writeStatus(loadPlanSet(key), tab.selected, status, note);
      refreshAll(context);
      return;
    }
    if (event.kind === "form" && event.action === ACTIONS.saveEdit) {
      if (tab.selected === null) return;
      const found = findTask(key, tab.selected);
      if (!found) return;
      writeFileSync(found.task.file, String(event.values["text"] ?? ""), "utf8");
      tab.editing = false;
      refreshTab(key, context);
      app.toast(`Saved ${basename(found.task.file)}`, "success");
    }
  } catch (error) {
    app.toast(failure(error), "error");
    refreshTab(key, context);
  }
}

async function newTask(root: string, context: Context): Promise<void> {
  const title = await context.app.input({
    title: "New task",
    placeholder: "What should be true when it is done?",
  });
  if (title === null || !title.trim()) return;
  const file = createTask(root, title);
  const id = basename(file).slice(0, 3);
  const tab = tabs.get(tabKey(root) ?? root);
  if (tab) {
    tab.selected = id;
    tab.editing = false;
  }
  refreshTab(root, context);
  await context.app.openFile({ path: file });
}

async function generate(root: string, context: Context): Promise<void> {
  const answer = await context.app.input({
    title: "Ask /improve",
    value: "",
    placeholder: "empty = full audit; or: plan <what to build>, quick, security, next ...",
  });
  if (answer === null) return;
  await openImprove(root, answer, context);
}

// ---------------------------------------------------------------------------
// Agent tools
// ---------------------------------------------------------------------------

function failed(text: string): CallToolResult {
  return { content: [{ type: "text", text }], outcome: "failed" };
}

async function toolRoot(root: string | null, context: Context): Promise<string | null> {
  if (root) return root;
  const workspace = await context.app.workspaceContext();
  return workspace.groups[0]?.root ?? null;
}

async function listTool(_args: unknown, root: string | null, context: Context): Promise<string | CallToolResult> {
  const where = await toolRoot(root, context);
  if (where === null) return failed("No group is open.");
  const set = loadPlanSet(where);
  if (set.dir === null) return `No plans folder in ${where}.`;
  const lines = [`plans: ${set.dir}`];
  for (const task of set.tasks) {
    const deps = task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "-";
    const status = task.statusNote ? `${task.status} — ${task.statusNote}` : task.status;
    lines.push(`${task.id}\t${status}\t${task.title}\tafter: ${deps}\t${planPathOf(where, task.file)}`);
  }
  return lines.join("\n");
}

async function setStatusTool(args: unknown, root: string | null, context: Context): Promise<string | CallToolResult> {
  const where = await toolRoot(root, context);
  if (where === null) return failed("No group is open.");
  const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const id = input["id"];
  const status = input["status"];
  const note = input["note"];
  if (typeof id !== "string" || !/^\d{3}$/.test(id)) return failed("id must be a three-digit plan id, e.g. 003.");
  if (typeof status !== "string" || !TASK_STATUSES.includes(status as TaskStatus)) {
    return failed(`status must be one of ${TASK_STATUSES.join(", ")}.`);
  }
  const set = loadPlanSet(where);
  if (set.dir === null) return failed(`No plans folder in ${where}.`);
  if (!set.tasks.some((t) => t.id === id)) return failed(`No task ${id} in ${set.dir}.`);
  const line = typeof note === "string" ? note.replace(/[\r\n]+/g, " ").trim() || null : null;
  writeStatus(set, id, status as TaskStatus, line);
  refreshAll(context);
  return `Task ${id} is now ${status}.`;
}

// ---------------------------------------------------------------------------
// List rows
// ---------------------------------------------------------------------------

const NO_ROWS: RowsResult = { kind: "list", rows: [] };

function tabListRows(params: RowsParams): RowsResult {
  if (params.node !== KEYS.tasks || !params.instance) return NO_ROWS;
  return { kind: "list", rows: taskRows(tabState(params.instance, false), params.start, params.end) };
}

async function sidebarListRows(params: RowsParams, context: Context): Promise<RowsResult> {
  if (params.node !== KEYS.sidebarTasks) return NO_ROWS;
  const root = sidebarRoot ?? (await sidebarGroup(context));
  if (root === null) return NO_ROWS;
  return { kind: "list", rows: sidebarRows(tabState(root, false), params.start, params.end) };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

async function withRoot(
  target: CommandTarget | null,
  context: Context,
  action: (root: string) => Promise<unknown> | unknown,
): Promise<void> {
  const root = await rootFor(target, context);
  if (root === null) {
    context.app.toast("Open a group first.", "info");
    return;
  }
  await action(root);
}

createExtension({
  async onInitialize(context) {
    current = options(await context.app.getSettings());
  },

  onShutdown() {
    watcher?.stop();
    watcher = null;
  },

  onSettingsChanged(values, context) {
    const before = current.kradPath;
    current = options(values);
    if (current.kradPath !== before) {
      kradCli = null;
      kradMissingWarned = false;
    }
    refreshAll(context);
  },

  onWorkspaceEvent(event, context) {
    if (event.kind !== "file_saved") return;
    for (const root of tabs.keys()) {
      const dir = findPlansDir(root);
      if (dir !== null && isInside(event.path, dir)) refreshTab(root, context);
    }
    // The sidebar follows its group's plans, and a new plans/ folder may change its group.
    if (/[\\/]plans[\\/]/i.test(event.path)) refreshSidebar(context);
  },

  commands: {
    "tasklist.open": (target, context) => withRoot(target, context, (root) => openTab(root, context)),
    "tasklist.refresh": (_target, context) => refreshAll(context),
    "tasklist.new-task": (target, context) => withRoot(target, context, (root) => newTask(root, context)),
    "tasklist.generate": (target, context) => withRoot(target, context, (root) => generate(root, context)),
    "tasklist.reconcile": (target, context) =>
      withRoot(target, context, (root) => openImprove(root, "reconcile", context)),
    "tasklist.run-next": (target, context) => withRoot(target, context, (root) => runNext(root, context)),
    "tasklist.auto-run": (target, context) => withRoot(target, context, (root) => startAutoRun(root, context)),
    "tasklist.stop": (target, context) => withRoot(target, context, (root) => stopAutoRun(root, context)),
  },

  views: {
    tasks: {
      render(_view, context) {
        return renderSidebar(context);
      },
      rows(params, context) {
        return sidebarListRows(params, context);
      },
      onEvent(event, _view, context) {
        return onSidebarEvent(event, context);
      },
      onClose() {
        sidebarOpen = false;
      },
    },
    tasklist: {
      render(view) {
        const root = view.instance ?? "";
        if (tabKey(root) === undefined) tabs.set(root, newTab());
        return tasklistView(tabState(root));
      },
      rows(params) {
        return tabListRows(params);
      },
      onEvent(event, view, context) {
        if (!view.instance) return;
        return onTabEvent(event, view.instance, context);
      },
      onClose(view) {
        const key = view.instance ? tabKey(view.instance) : undefined;
        if (key !== undefined) tabs.delete(key);
      },
    },
  },

  tools: {
    tasklist_list: listTool,
    tasklist_set_status: setStatusTool,
  },
});
