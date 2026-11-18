# Plan 003: Draw the Tasklist tab (`src/view.ts`)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git log --oneline -1` must show plan 001's scaffold commit and
> `src/types.ts` must export `Task`, `PlanSet`, `RunRecord`. If not, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-scaffold-extension.md
- **Category**: direction
- **Planned at**: no commit (planned before plan 001 created the repo), 2026-11-18

## Why this matters

This is the "new tab of Krad" the user asked for: a file tab that lists the plans as tasks with their
status, shows the selected plan rendered as Markdown, and offers every action — edit, change status,
run here, run in a worktree, compare in variants, run the next, start/stop an auto-run. Views in Krad
are *descriptions* (JSON nodes) the app draws; this plan writes pure functions that build those nodes so
they can be unit-tested without the app. Plan 005 wires them to events.

## Current state

- Plan 001 created the project. Read `src/types.ts` (contract: `Task`, `PlanSet`, `RunRecord`,
  `TaskStatus`, `Harness`). Do not change it.
- `src/plans.ts` (plan 002) and `src/runner.ts` (plan 004) are being written **in parallel** in other
  worktrees: do NOT import them. This module imports only `./types.js` and `@krad-ade/extension`.
- SDK builders available (`@krad-ade/extension@0.4.0`, `import { ui } from "@krad-ade/extension"`):
  `ui.column(key, children, style?)`, `ui.row(key, children, style?)`, `ui.flex(key, children, opts)`,
  `ui.scroll(key, children, direction?)`, `ui.text(key, text, style?)` (style:
  `{ size?: "xs"|"sm"|"md"|"lg", weight?: "regular"|"medium"|"bold", color?: ColorToken, wrap?: "wrap"|"no_wrap", font?: "interface"|"mono" }`),
  `ui.markdown(key, text)`, `ui.badge(key, text, tone)`, `ui.button(key, action, { label, icon, variant: "primary"|"secondary"|"ghost"|"danger", enabled: "yes"|"no", tooltip })`,
  `ui.select(key, action, options: {value,label}[], value)`, `ui.tree(key, items: TreeItem[])`,
  `ui.form(key, submitAction, fields, submitLabel)`, `ui.details(key, [{label, value}])`,
  `ui.divider(key)`, `ui.spinner(key)`.
  `TreeItem = { key, label, description?, icon?, badge?: {text, tone}, expansion?: "leaf"|"collapsed"|"expanded", children?, actions?: ItemAction[], menu?: ItemAction[] }`,
  `ItemAction = { action, label, icon?, tone? }`. Tones: `neutral|info|success|warning|error`.
  Icons (only these exist): `add attach bell book cancel check chevron-* close copy exchange expand file flag flash flow folder git-branch key layers list-view loading lock magic minus more note open-external pencil play plug refresh repeat search settings stop target tasks terminal tree-view undo workflow`.
  Form field: `{ key, label, type: "text", value, kind: "multiline" }`.
  Tree events arrive as `{ kind: "item_action", action, item: <TreeItem.key> }`; a click on a tree row
  sends no event — so **selection is an item action** (`select`), and buttons send `{ kind: "click", action }`;
  selects send `{ kind: "select", action, value }`; forms `{ kind: "form", action, values }`.
- Exemplar to match (krad-docker `src/tree.ts`): constant `ACTIONS` object, exported `*_KEY` constants,
  `BADGES` record by state, small pure functions returning `TreeItem`/`Node`:
  ```ts
  export const ACTIONS = { start: "start", stop: "stop", /* ... */ } as const;
  const BADGES: Record<ContainerState, Badge> = { running: { text: "running", tone: "success" }, /* ... */ };
  export function containerItem(container: Container): TreeItem {
    return { key: container.id, label: container.service ?? container.name, description: container.image,
      icon: "layers", badge: BADGES[container.state], expansion: "leaf",
      actions: inlineActions(container), menu: menu(container) };
  }
  ```

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Build + tests | `npm test` | `ℹ fail 0` |
| This plan's tests | `npm run build && node --test test/view.test.mjs` | all pass |

## Scope

**In scope**: `src/view.ts` (create), `test/view.test.mjs` (create), `package.json` (only the `bundle`
line, step 1), `dist/**` (rebuilt), row 003 of `plans/README.md`.

**Out of scope**: `src/types.ts`, `src/main.ts`, `src/plans.ts`, `src/runner.ts`, `extension.toml`.

## Git workflow

Stay on your worktree branch; imperative commit messages (`Draw the Tasklist tab`). No push, no merge.

## Steps

### Step 1: Bundle library modules for tests

Set the `bundle` script to
`esbuild src/*.ts --bundle --platform=node --format=esm --target=node20 --outdir=dist`
(plans 002/004 make the identical change; leave it if already so).

**Verify**: `npm run build && ls dist/main.js dist/types.js` → both exist.

### Step 2: Implement `src/view.ts`

Export these names exactly (plan 005 uses them):

```ts
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

export const KEYS = { root: "root", toolbar: "toolbar", summary: "summary", tasks: "tasks",
  detail: "detail", problems: "problems", session: "session" } as const;

export interface SessionInfo { active: boolean; done: number; total: number; running: number; message: string | null; }

export interface TabState {
  set: PlanSet;
  runs: RunRecord[];          // runs of this root, latest per task first
  selected: string | null;    // task id
  editing: boolean;           // quick editor open for the selected task
  planText: string | null;    // contents of the selected plan file
  session: SessionInfo;
}

export function tasklistView(state: TabState): Node;   // whole tab, key KEYS.root
export function toolbar(state: TabState): Node;        // key KEYS.toolbar
export function summary(state: TabState): Node;        // key KEYS.summary
export function taskItems(state: TabState): TreeItem[];
export function taskTree(state: TabState): Node;       // ui.tree(KEYS.tasks, taskItems(state))
export function taskDetail(state: TabState): Node;     // key KEYS.detail
export function statusBadge(task: Task, run: RunRecord | null): Badge;
```

Layout of `tasklistView` (a `ui.column(KEYS.root, [...], { gap: "md", padding: "md" })` — check the
`Style` type in `node_modules/@krad-ade/extension/dist/view.d.ts` for the exact style field names and use
what exists):
1. `toolbar`: a row of buttons — `New task` (newTask, icon add), `Write plans` (generate, magic),
   `Reconcile` (reconcile, repeat), `Refresh` (refresh, refresh), then `Run next` (runNext, play,
   primary), and `Auto-run` (autoRun, flash) **or**, while `session.active`, `Stop` (stop, stop, danger).
   `Run next` and `Auto-run` are `enabled: "no"` when no task is TODO.
2. `summary`: text like `3 of 7 done · 1 running · 1 blocked`; when `session.active`, prefix
   `Auto-run: ` and append `session.message` if any. When `set.dir === null`, instead show
   `No plans in this folder yet. Write some with /improve or add a task.`
3. When `set.problems.length > 0`: a column `KEYS.problems` of warning-colored texts (`color: "warning"`).
4. A row with the tree `KEYS.tasks` (left, `width` ~40% if the Style type supports it) and
   `taskDetail` (right, fills).

`taskItems`: one `TreeItem` per task, `key = task.id`, `label = "<id> · <title>"`, `description` =
`[priority, effort, deps ? "after " + deps.join(", ") : null].filter(Boolean).join(" · ")`,
`icon` by status (`TODO: "note"`, `IN PROGRESS: "loading"`, `DONE: "check"`, `BLOCKED: "flag"`,
`REJECTED: "close"`), `badge = statusBadge(task, run)`, `expansion: "leaf"`,
`actions` = `[select (icon "search", label "Open")]` plus `run` (icon play) only when the task is TODO or
BLOCKED and has no live run, `menu` = run, runWorktree, variants, edit, quickEdit.

`statusBadge`: a live run (state `starting|working|idle|unknown`) wins → `{ text: "running", tone: "info" }`;
`waiting-for-input` → `{ text: "needs you", tone: "warning" }`; otherwise by status — TODO neutral,
IN PROGRESS info, DONE success, BLOCKED error, REJECTED neutral (text `rejected`), lowercase words.

`taskDetail`: when nothing is selected, a muted text `Select a task to read its plan.`. Otherwise a
column with: title (bold, lg); a `ui.select` (action `setStatus`) over the 5 statuses with the current
one; `ui.details` with Priority, Effort, Risk, Depends on, File (path), and — when a run exists —
Agent (harness), Where (`cwd`), Branch, State, Started; buttons Run (primary), Run in worktree,
Compare agents (variants), Edit in editor, Quick edit; `statusNote` as a warning text when present; then
either the plan as `ui.markdown("plan-md", planText)` inside a `ui.scroll`, or, when `editing`, a
`ui.form("plan-form", ACTIONS.saveEdit, [{ key: "text", label: "Plan (Markdown)", type: "text",
kind: "multiline", value: planText }], "Save")` plus a `Cancel` button (cancelEdit).
Disable Run/Run in worktree (`enabled: "no"`) while a live run exists for the task.

All node keys inside a view must be unique: prefix detail keys with `detail-`.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Tests `test/view.test.mjs`

Import from `../dist/view.js`. Build a `TabState` literal by hand (no parser) with 4 tasks: 001 DONE,
002 TODO depending on 001, 003 BLOCKED with note, 004 TODO, plus one `RunRecord` for 002 in state
`working`. Tests:
1. `taskItems` returns keys `["001","002","003","004"]`; 002's badge is `running`/info; 001 has no
   `run` inline action; 004 has it.
2. `statusBadge` maps every status and `waiting-for-input` as specified.
3. `toolbar` shows `stop` and not `auto-run` when `session.active`; `run-next` disabled when no TODO.
4. `taskDetail` with `selected: "003"` contains a `markdown` node with the plan text and a warning text
   with the note; with `editing: true` contains a `form` whose `submit` is `save-edit`.
5. `tasklistView` with `set.dir: null` shows the "No plans in this folder yet" text.
6. All keys in `tasklistView(state)` are unique (walk `children` recursively, collect `key`).

**Verify**: `node --test test/view.test.mjs` → ≥ 6 pass; `npm test` → `ℹ fail 0`.

### Step 4: Commit

**Verify**: `git status --porcelain` → empty.

## Test plan

Step 3. Structural pattern: krad-docker-style assertions on node shapes, e.g.
`assert.deepEqual(items.map((i) => i.key), [...])`.

## Done criteria

- [ ] `npm test` exits 0
- [ ] `src/view.ts` imports nothing from `./plans.js` or `./runner.js` (`grep -cE "plans\.js|runner\.js" src/view.ts` → `0`)
- [ ] Only in-scope files changed vs. `main` (`git diff main --stat`)
- [ ] Row 003 in `plans/README.md` is `DONE`

## STOP conditions

- An icon, style field or node type named here does not exist in the installed SDK's `view.d.ts`
  (pick the nearest existing one only for icons/style; for missing node types, STOP).
- You need to change `src/types.ts`.

## Maintenance notes

- Large plans render as one Markdown node; if the app becomes slow, show only the selected plan (already
  the case) and never all plans at once.
- Action ids are a contract with plan 005's event handler — rename only together.
