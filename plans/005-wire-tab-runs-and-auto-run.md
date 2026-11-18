# Plan 005: Wire the tab, agent runs, the auto-run session and agent tools (`src/main.ts`, `src/scheduler.ts`)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: on `main`, `ls src/types.ts src/plans.ts src/view.ts src/runner.ts` must
> list all four and `npm test` must pass. If any is missing, STOP: plans 002–004 are not merged yet.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/002-plan-model.md, plans/003-tasklist-tab-view.md, plans/004-agent-runner.md
- **Category**: direction
- **Planned at**: no commit (planned before plan 001 created the repo), 2026-11-18

## Why this matters

Plans 002–004 built the parts: the plan reader/writer, the tab's node builders and the agent runner.
This plan makes them one working extension: the Tasklist tab opens per group, refreshes when plan files
change, edits plans, runs a task here or in a worktree, compares agents with Krad variants, runs an
**auto-run session** that walks the dependency graph (one by one, or N in parallel, each in its own
worktree), and gives every agent two tools to read and update the task list.

## Current state

Read these files fully before starting — they are the API you wire (all on `main`):
- `src/types.ts` — `Task`, `PlanSet`, `RunRecord`, `RunVerdict`, `Harness`, `AgentState`.
- `src/plans.ts` — `findPlansDir, loadPlanSet, parseStatus, setStatusInIndex, writeStatus, runnableTasks, createTask`.
- `src/view.ts` — `ACTIONS`, `KEYS`, `TabState`, `SessionInfo`, `tasklistView`, `toolbar`, `summary`, `taskTree`, `taskDetail`.
- `src/runner.ts` — `taskPrompt, improvePrompt, harnessCommand, variantsCommand, worktreeFor, isGitRepo, createWorktree, findKrad, listAgents, AgentWatcher`.
- `src/main.ts` — the placeholder from plan 001 (you replace it).
- `extension.toml` — commands `tasklist.open|refresh|new-task|generate|reconcile|run-next|auto-run|stop`,
  view `tasklist` (zone `file_tab`, instance = group root), titlebar item `tasklist`, settings
  `harness, execution-style, extra-args, max-parallel, stop-on-failure, krad-path`, tools
  `tasklist_list`, `tasklist_set_status`.

SDK facts (`@krad-ade/extension@0.4.0`): `ExtensionDefinition = { onInitialize, onShutdown, commands,
views: { [id]: { render(view, ctx), onEvent(event, view, ctx), onClose(view, ctx) } }, tools: { [name]:
(args, root, ctx) => string | { content: [{type:"text",text}], outcome: "done"|"failed" } },
onWorkspaceEvent(event, ctx), onSettingsChanged(values, ctx) }`. Workspace events include
`{ kind: "file_saved", path }` and `{ kind: "groups_changed", groups }`. `app.patchView(view, [patch.replace(node)])`
replaces the node with the same key. `app.setTitlebarItem({ item: "tasklist", active })`.
`app.progress({ token, state: "begin"|"report"|"end", title?, message?, percent? })`.
`app.confirm({ title, detail, confirm, tone }) → "confirmed" | "cancelled"`,
`app.pick({ title, items: [{value,label}], mode: "one"|"many" }) → string[] | null`,
`app.input({ title, value?, placeholder? }) → string | null`.

Exemplar for module state and settings (krad-docker `src/main.ts`):
```ts
const DEFAULTS: Options = { program: "docker", showStopped: true, pollSeconds: 5 };
function options(values: SettingsValues): Options { /* type-check each value, fall back to DEFAULTS */ }
let current = DEFAULTS;
createExtension({
  async onInitialize(context) { current = options(await context.app.getSettings()); },
  onSettingsChanged(values, context) { current = options(values); schedule(context); void refresh(context); },
  onShutdown() { clearInterval(poller); for (const id of followers.keys()) stopFollowing(id); },
  ...
});
function failure(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] ?? String(error) : String(error);
}
```

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Build + tests | `npm test` | `ℹ fail 0` |
| Scheduler tests | `npm run build && node --test test/scheduler.test.mjs` | all pass |

## Scope

**In scope**: `src/main.ts` (rewrite), `src/scheduler.ts` (create), `test/scheduler.test.mjs` (create),
`test/program.test.mjs` (extend), `README.md` (usage section), `dist/**`, row 005 of `plans/README.md`.

**Out of scope**: changing exported signatures in `src/types.ts`, `src/plans.ts`, `src/view.ts`,
`src/runner.ts` (bug fixes inside them are allowed only if a test proves the bug; list them in your
report). Merging worktree branches back into `main` (the user does that from Krad's Changes view).

## Git workflow

Branch `advisor/005-wire-everything` from `main` (or the worktree branch you were given). Commit per step.
No push, no merge.

## Steps

### Step 1: Pure scheduler `src/scheduler.ts`

```ts
import type { RunRecord, RunVerdict, Task, TaskStatus } from "./types.js";
export const LIVE_STATES = ["starting", "working", "idle", "waiting-for-input", "unknown"] as const;
export function isLive(run: RunRecord): boolean;            // state in LIVE_STATES and endedAt === null
/** An agent stopped: "done" → the turn ended, "exited"/"closed" → the process/tab ended. */
export function hasStopped(state: RunRecord["state"]): boolean;   // done | exited | closed
/** Decide the outcome from the plan status read AFTER the agent stopped. */
export function verdictFor(status: TaskStatus): RunVerdict;      // DONE→done, BLOCKED|REJECTED→blocked, else needs-review
/** Which tasks to launch now: runnable ones (TODO, deps DONE) without a live run, not already finished
 *  in this session, in id order, up to maxParallel − liveCount. */
export function nextLaunches(runnable: Task[], runs: RunRecord[], finishedInSession: Set<string>, maxParallel: number): Task[];
/** The session is over when nothing is live and nextLaunches is empty. */
export function sessionOver(runnable: Task[], runs: RunRecord[], finishedInSession: Set<string>, maxParallel: number): boolean;
```

Tests `test/scheduler.test.mjs`: verdict mapping; `nextLaunches` respects `maxParallel` (1 → one task;
3 with one live → two), skips tasks with live runs and finished ones, keeps id order; `sessionOver`.

**Verify**: `node --test test/scheduler.test.mjs` → all pass (≥ 4 tests).

### Step 2: State and settings in `src/main.ts`

Module state:
- `options` from settings (`harness: Harness` default `"claude"`, `style: "direct"|"improve"`,
  `extraArgs: string`, `maxParallel: number` 1–8 default 1, `stopOnFailure: boolean` default true,
  `kradPath: string` default `"krad"`), validated like the exemplar.
- `tabs: Map<string /*root*/, { selected: string|null; editing: boolean }>` for open tabs.
- `runs: RunRecord[]`; `sessions: Map<string /*root*/, { finished: Set<string>; blockedOrReview: string[]; token: string }>`.
- `watcher: AgentWatcher | null`, `kradCli: KradCli | null`.

`tabState(root)` builds a `TabState` from `loadPlanSet(root)`, the runs of that root, the tab's
selection, the selected plan file text (`readFileSync`, `null` on error) and the session info.
`refreshTab(root, ctx)` → `ctx.app.patchView({ view: "tasklist", instance: root }, [patch.replace(tasklistView(tabState(root)))])`
for open tabs only. Use `failure(error)` for messages.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: The `tasklist` view and commands

- `render(view)`: root = `view.instance`; register it in `tabs`; return `tasklistView(tabState(root))`.
  `onClose`: remove from `tabs`.
- `onEvent`:
  - `item_action` `select` → set `selected`, `editing=false`, refresh. `run`/`runWorktree`/`variants`/
    `edit`/`quickEdit` on `event.item` (task id) → same handlers as the buttons below.
  - `click` buttons: `newTask`, `generate`, `reconcile`, `refresh`, `runNext`, `autoRun`, `stop`, and for
    the selected task `run`, `runWorktree`, `variants`, `edit` (`app.openFile({ path: task.file })`),
    `quickEdit` (`editing=true`), `cancelEdit`.
  - `select` with action `setStatus` → `writeStatus(set, selected, value, note)`; for BLOCKED/REJECTED ask
    `app.input({ title: "Reason (one line)" })` first; refresh.
  - `form` `saveEdit` → `writeFileSync(task.file, String(values.text))`, `editing=false`, refresh, toast
    `Saved <file name>`.
- `onWorkspaceEvent`: `file_saved` whose path is inside an open tab's plans dir → refresh that tab.
- Commands (`target` handling: `group` target → its `root`; `file` target → its folder if it is a plans
  dir's README, else the group containing it; otherwise the single group of `workspaceContext()`, or
  `app.pick` among groups):
  - `tasklist.open` → `openView({ view: "tasklist", instance: root, title: "Tasklist · <folder name>" })`.
  - `tasklist.refresh` → refresh every open tab.
  - `tasklist.new-task` → `app.input({ title: "New task", placeholder: "What should be true when it is done?" })`,
    `createTask(root, title)`, select it, `openFile` it.
  - `tasklist.generate` → `app.input({ title: "Ask /improve", value: "", placeholder: "empty = full audit; or: plan <what to build>, quick, security, next ..." })`
    then open a terminal (zone `session`, cwd root, title `improve`) with
    `harnessCommand(options.harness, improvePrompt(answer), options.extraArgs)`.
  - `tasklist.reconcile` → same with `improvePrompt("reconcile")`.
  - `tasklist.run-next` → first of `runnableTasks(set.tasks)` without live run → `runTask(root, task, "here")`.
  - `tasklist.auto-run` / `tasklist.stop` → step 5.

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Running one task

`async function runTask(root, task, mode, ctx)`:
1. If a live run exists for `(root, task.id)`, toast `Task <id> is already running` and return.
2. `mode === "worktree"`: if `!(await isGitRepo(root))`, toast error `Run in a worktree needs a git repository` and
   return; else `createWorktree(root, task)` → `cwd = path`, `branch`. Before that, if `git status --porcelain -- plans`
   in root is non-empty, warn (toast info) that uncommitted plan edits will not be in the worktree.
   `mode === "here"`: `cwd = root`.
3. `planPath` = path of `task.file` relative to root, with `/` separators.
4. `writeStatus(set, id, "IN PROGRESS", null)` in **root**.
5. `terminal = await app.openTerminal({ title: "task <id> · <harness>", cwd, zone: "session", command: harnessCommand(options.harness, taskPrompt(task, planPath, options.style), options.extraArgs) })`.
6. Push a `RunRecord` (state `"starting"`), ensure the watcher runs (step 6), refresh the tab, toast
   `Started task <id> with <harness>`.
7. On any error: toast it, set status back to what it was.

Variants (`variants` action): `app.pick({ title: "Compare agents", mode: "many", items: HARNESSES.map(...) })`;
need 2–4; open a terminal (zone `utilities`, cwd root, title `variants · <id>`) with
`variantsCommand(picked, taskPrompt(task, planPath, "direct"))`; toast `Variants started — compare them in Krad's Variants view`.
(Variants runs are not tracked as `RunRecord`s.)

**Verify**: `npm run typecheck` → exit 0.

### Step 5: Run end detection, verdicts and the auto-run session

`onAgentChange(agent)` (from the watcher): find the `RunRecord` whose `terminal === agent.terminal`
and `endedAt === null`; update `state`. When `agent.state === "waiting-for-input"`: toast warning
`Task <id> waits for you in "task <id> · <harness>"` once per transition. When `hasStopped(state)`:
- read the task's status: in `mode === "worktree"` from `<worktree>/plans/README.md` (via `loadPlanSet(worktree)`),
  else from root;
- `verdict = verdictFor(status)`; if `worktree` mode, mirror the status into **root**'s index with
  `writeStatus` (note `"in worktree <branch>"` appended for DONE so the user knows where the code is);
- `verdict === "needs-review"`: leave the root status `IN PROGRESS` and toast warning
  `Task <id> stopped without updating its status — review it`;
- set `endedAt`, refresh the tab, then `advanceSession(root, ctx)`.

Note: for interactive harnesses `done` means "turn finished" — an agent that asks a question also ends
its turn. That is why the verdict comes from the plan status, not from the agent state.

Auto-run (`tasklist.auto-run` command / `autoRun` button):
- If no runnable task → toast info `Nothing to run: every TODO task waits on another one` and return.
- If `maxParallel > 1` and root is not a git repo → confirm `Run one at a time?` (git needed for
  parallel worktrees); on confirm continue with 1, else return.
- Confirm once: `Start an auto-run of <n> tasks with <harness>, <maxParallel> at a time?` — tone
  `warning` — agents will edit files.
- Create the session (`finished = new Set()`, `token = "tasklist-<root>"`), `app.progress begin`,
  `app.setTitlebarItem({ item: "tasklist", active: true })`, then `advanceSession`.

`advanceSession(root)`: if no session, return. If `stopOnFailure` and the session has a blocked or
needs-review task → end the session with toast warning `Auto-run stopped: task <id> <blocked|needs review>`.
Else launches = `nextLaunches(runnableTasks(loadPlanSet(root).tasks), runsOf(root), finished, maxParallel)`;
mode `here` when `maxParallel === 1`, else `worktree`; `runTask` each and add to `finished` when it ends.
If `sessionOver` → end with toast success `Auto-run finished: <done>/<total> tasks done`.
Report progress (`state: "report", message: "<done> of <total> done"`).
Ending: progress `end`, titlebar `active: false`, delete the session, refresh.

`tasklist.stop` / `stop` button: confirm `Stop the auto-run?` → end the session (running agents keep
running; say so in the toast: `Auto-run stopped. Agents already running keep working.`).

**Verify**: `npm run typecheck` → exit 0; `node --test test/scheduler.test.mjs` passes.

### Step 6: The watcher

On the first run start: `kradCli ??= await findKrad(options.kradPath)`. If null → toast warning once:
`Cannot find the krad CLI; set "Krad CLI" in the extension settings. Task states will not update by themselves — set them in the tab.`
Else `watcher = new AgentWatcher(kradCli, onAgentChange, (m) => app.log("warn", m))`, `start()`.
Stop it in `onShutdown` and when no run is live and no session is active.

**Assumption check (do this in the real app before closing the plan, see STOP)**: the number returned by
`openTerminal` should equal the bus `terminal` id. If an `AgentInfo` with an unknown terminal arrives
whose `title` starts with `task <id> · ` of a live run in `"starting"` state, adopt that terminal id into
the run (title fallback). Keep both paths.

### Step 7: Agent tools

- `tasklist_list(args, root)`: root from the tool's `root` argument, else the first group; returns text
  lines `<id>\t<status>\t<title>\tafter: <deps or ->\t<relative plan path>` plus a first line
  `plans: <dir>`; when no plans dir → `No plans folder in <root>.`
- `tasklist_set_status(args, root)`: validate `id` (3 digits, known task) and `status` (one of
  `TASK_STATUSES`); `writeStatus`; refresh open tabs; return `Task <id> is now <status>.`; on invalid
  input return `{ content: [{ type: "text", text: "<why>" }], outcome: "failed" }`.

### Step 8: Program tests and README

Extend `test/program.test.mjs`: copy `test/fixtures/plans` (from plan 002) into a temp root; render
`{ view: "tasklist", instance: tempRoot }` → the tree with key `tasks` lists the fixture ids; call tool
`tasklist_list` with `root: tempRoot` → text includes `004`; call `tasklist_set_status`
`{ id: "005", status: "DONE" }` → README row 005 now `DONE`; an unknown id → `outcome: "failed"`.
Answer `settings/get` with `{}` and `workspace/context` with `{ groups: [{ id: "g", name: "g", root: tempRoot }] }`.

README: a "Use" section — open the tab (titlebar button, `Tasklist: Open`, group menu,
Ctrl+Alt+Shift+T), write plans with `/improve` (needs the improve skill installed for the chosen
agent: `https://github.com/shadcn/improve`), edit (editor or quick edit), run one, run in a worktree,
compare agents (variants), auto-run (settings `max-parallel`, `stop-on-failure`), and the agent tools.

**Verify**: `npm test` → `ℹ fail 0`.

### Step 9: Manual check in Krad (report results; do not block on it)

Add this folder in Krad (Settings → Extensions → Add folder), trust it, open a group with plans,
open the Tasklist tab, select a task, run it with the default agent, watch the badge go `running` and,
when the agent finishes and sets the row to DONE, `done`. Report what you saw, including whether the
terminal-id assumption held.

## Test plan

- `test/scheduler.test.mjs` (step 1), extended `test/program.test.mjs` (step 8). Pure logic is tested
  through `dist/scheduler.js`; the agent-facing parts through the program protocol.

## Done criteria

- [ ] `npm test` exits 0, `ℹ fail 0`
- [ ] `grep -c "tasklist_set_status" src/main.ts` ≥ 1 and every command id of `extension.toml` appears in `src/main.ts`
      (`for c in open refresh new-task generate reconcile run-next auto-run stop; do grep -q "tasklist.$c" src/main.ts || echo MISSING $c; done` prints nothing)
- [ ] `dist/main.js` rebuilt and committed; `git status --porcelain` empty
- [ ] Row 005 in `plans/README.md` is `DONE`; the report states the outcome of step 9

## STOP conditions

- Plans 002–004 are not on `main` (drift check).
- `openTerminal` rejects with a permissions error even though `extension.toml` declares `terminals`.
- In step 9, neither the terminal id nor the title fallback ever matches the bus agent — report the
  observed `krad list --json` output next to the run you started; do not invent a third mechanism.
- You need to change an exported signature of plans 002–004.

## Maintenance notes

- Krad agents are interactive: "done" = turn ended, so a task can end in `needs-review` when the agent
  asks a question. That is deliberate; never auto-mark DONE from the agent state.
- Worktree runs leave branches `tasklist/<id>-<slug>` and folders `<root>.worktrees/…`; merging them is
  the user's job (Krad's Changes view). A later plan could add "Merge"/"Remove worktree" actions.
- When the SDK gains app events (`events/subscribe`, api 1.2), replace the CLI watcher with them.
