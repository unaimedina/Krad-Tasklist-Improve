# Plan 001: Scaffold the "Tasklist" Krad ADE extension from the krad-docker skeleton

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: this folder had no git repository when the plan
> was written. Run `git -C . rev-parse --is-inside-work-tree`. If it prints
> `true` AND any of `src/`, `test/`, `extension.toml`, `package.json` already
> exist, STOP — someone already scaffolded it.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: no commit (empty folder), 2026-11-18. Reference skeleton: `https://github.com/joordih/krad-docker` commit `5968096`; SDK `@krad-ade/extension@0.4.0` (npm).

## Why this matters

We are building a new Krad ADE extension, **Tasklist**, that shows the implementation plans written by
the `improve` skill (`plans/README.md` + `plans/NNN-*.md`) as a TODO list in a Krad tab, lets the user
edit them, and runs them with coding agents one by one, in parallel or in an auto-run session. Every
later plan (002–005) builds on the files, the build pipeline, the manifest and the **shared types** this
plan creates. Plans 002, 003 and 004 run in parallel after this one, so the contract in `src/types.ts`
and the full manifest must be exactly as specified here — they will not edit each other's files.

## Current state

- `D:\Codigo\Utilidades\Krad-Tasklist-Improve` (the repository root, "ROOT" below) contains only
  `plans/`. It is **not** a git repository yet.
- Toolchain verified on this machine: Node v26, npm 11, git 2.56 (Windows; use the Bash tool / Git Bash
  or PowerShell — commands below are POSIX-sh).
- The skeleton to copy from is **krad-docker** (an extension by the same author). Its relevant facts,
  inlined so you need not read it (you MAY clone it to a scratch folder *outside ROOT* to look:
  `git clone https://github.com/joordih/krad-docker "$TMP/krad-docker"`):

  `package.json` of krad-docker:
  ```json
  {
    "name": "krad-docker", "version": "0.1.0", "private": true,
    "license": "MIT OR Apache-2.0", "type": "module", "engines": { "node": ">=20" },
    "scripts": {
      "typecheck": "tsc -p tsconfig.json",
      "bundle": "esbuild src/main.ts --bundle --platform=node --format=esm --target=node20 --outfile=dist/main.js",
      "build": "npm run typecheck && npm run bundle",
      "test": "npm run build && node --test test/*.test.mjs"
    },
    "dependencies": { "@krad-ade/extension": "^0.3.0" },
    "devDependencies": { "@types/node": "^20.0.0", "typescript": "^5.6.0", "esbuild": "^0.25.0" }
  }
  ```
  `tsconfig.json` of krad-docker:
  ```json
  { "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
      "outDir": "dist", "rootDir": "src", "strict": true, "noUncheckedIndexedAccess": true,
      "skipLibCheck": true, "types": ["node"] }, "include": ["src"] }
  ```
  `.gitignore`: `node_modules/`. The repo **commits `dist/`** (the app runs `dist/main.js` without
  installing anything).

  Program entry pattern (krad-docker `src/main.ts`, trimmed):
  ```ts
  import type { Context, SettingsValues } from "@krad-ade/extension";
  import { createExtension, patch, ui } from "@krad-ade/extension";
  createExtension({
    async onInitialize(context) { current = options(await context.app.getSettings()); },
    onSettingsChanged(values, context) { current = options(values); },
    commands: { "containers.refresh": async (_target, context) => { /* ... */ } },
    views: { containers: { async render(view, context) { return node; },
                           async onEvent(event, view, context) { /* ... */ }, onClose(view, context) {} } },
    tools: { list_containers: async (args) => "text" },
  });
  ```
  Program test pattern (krad-docker `test/program.test.mjs`, trimmed) — spawn `dist/main.js`, speak
  framed JSON-RPC:
  ```js
  import { encodeFrame, FrameDecoder } from "@krad-ade/extension";
  const child = spawn(process.execPath, ["dist/main.js"], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });
  // decoder.push(chunk) yields messages; answer "settings/get" requests from the program with an object;
  // send({ id: 1, method: "initialize", params: INIT }) then await the reply with the same id.
  const INIT = { app: { name: "Krad ADE", version: "0.3.0" }, api: "1.0", placement: "app",
                 extension_folder: root, features: ["views", "commands", "tools"] };
  ```
- SDK facts (`@krad-ade/extension@0.4.0`): `ui.*` builders (`column,row,text,markdown,button,tree,form,
  details,badge,select,divider,spinner,terminal,...`), `patch.*` (`replace,replaceItem,append,...`),
  `Context = { app, init }`; `app.openView/openFile/openTerminal/toast/confirm/pick/input/progress/
  patchView/workspaceContext/getSettings/setTitlebarItem`. Settings types in the manifest: `text`,
  `toggle`, `number`, `choice` (`options = [{value,label}]`). Permissions: `terminals`, `run_commands`.
  View zones: `sidebar`, `side_panel`, `utilities`, `file_tab`, `popover`. A `[[contributes.titlebar_item]]`
  needs `api = "1.1"`.

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Install   | `npm install` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no output errors |
| Build     | `npm run build` | exit 0, `dist/main.js` exists |
| Tests     | `npm test` | `ℹ fail 0` and exit 0 |

## Scope

**In scope** (create): `package.json`, `package-lock.json` (generated), `tsconfig.json`, `.gitignore`,
`extension.toml`, `README.md`, `LICENSE-MIT`, `src/types.ts`, `src/main.ts`, `test/program.test.mjs`,
`dist/main.js` (generated), and the row 001 in `plans/README.md`.

**Out of scope**: `src/plans.ts`, `src/view.ts`, `src/runner.ts`, `src/scheduler.ts` (plans 002–005 own
them — do NOT create them, not even as stubs); every other file in `plans/`.

## Git workflow

- Run `git init -b main` in ROOT (step 1). Commit at the end of the plan on `main` with message
  `Scaffold the Tasklist extension for Krad ADE` (imperative sentence, like krad-docker's history:
  "Add the Docker extension for Krad ADE"). Commit `plans/` too. Do NOT push.

## Steps

### Step 1: Initialise the repository and the npm project

`git init -b main`. Create `.gitignore` with exactly `node_modules/`. Create `package.json`:

```json
{
  "name": "krad-tasklist",
  "version": "0.1.0",
  "private": true,
  "description": "Plans as a task list in Krad ADE: read, edit and run them with agents.",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "bundle": "esbuild src/main.ts --bundle --platform=node --format=esm --target=node20 --outfile=dist/main.js",
    "build": "npm run typecheck && npm run bundle",
    "test": "npm run build && node --test \"test/*.test.mjs\""
  },
  "dependencies": { "@krad-ade/extension": "^0.4.0" },
  "devDependencies": { "@types/node": "^20.0.0", "typescript": "^5.6.0", "esbuild": "^0.25.0" }
}
```

Note the quoted glob in `test` — required so it works from Windows `cmd` (Node expands it itself).
Copy `tsconfig.json` exactly as in "Current state". Then `npm install`.

**Verify**: `npm ls @krad-ade/extension` → prints `@krad-ade/extension@0.4.x`.

### Step 2: Write the shared contract `src/types.ts`

Create it with EXACTLY these exports (plans 002–005 import them; changing names breaks them):

```ts
/** Status words of the improve skill's plans/README.md status table. */
export const TASK_STATUSES = ["TODO", "IN PROGRESS", "DONE", "BLOCKED", "REJECTED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** One plan file plans/NNN-slug.md, merged with its row in plans/README.md. */
export interface Task {
  id: string;              // "001" — three digits, from the file name
  slug: string;            // "scaffold-extension"
  file: string;            // absolute path of the plan file
  title: string;           // from "# Plan 001: <title>", else the index row, else the slug
  priority: string | null; // "P1" | "P2" | "P3" as written, null when absent
  effort: string | null;   // "S" | "M" | "L"
  risk: string | null;     // "LOW" | "MED" | "HIGH"
  dependsOn: string[];     // ids, e.g. ["001", "002"]; [] for none
  status: TaskStatus;
  statusNote: string | null; // text after the status word, e.g. the BLOCKED reason
}

/** Everything read from one group's plans folder. */
export interface PlanSet {
  root: string;              // the group folder (repository root)
  dir: string | null;        // absolute plans folder, null when none was found
  indexFile: string | null;  // absolute plans/README.md, null when absent
  tasks: Task[];             // sorted by id
  problems: string[];        // human-readable parse warnings
}

export const HARNESSES = ["claude", "codex", "opencode"] as const;
export type Harness = (typeof HARNESSES)[number];

/** States of the Krad agents bus (krad agents list / watch). */
export type AgentState = "idle" | "working" | "waiting-for-input" | "done" | "exited" | "closed";

/** How a task is being executed. */
export type RunMode = "here" | "worktree";

/** One agent run of one task, tracked by the extension. */
export interface RunRecord {
  taskId: string;
  root: string;              // group root the task belongs to
  terminal: number;          // id returned by app.openTerminal
  harness: Harness;
  mode: RunMode;
  cwd: string;               // where the agent works (root, or the worktree path)
  worktree: string | null;   // absolute worktree path when mode === "worktree"
  branch: string | null;
  state: AgentState | "starting" | "unknown";
  startedAt: string;         // ISO time
  endedAt: string | null;
}

/** Outcome of a finished run, decided from the plan status after the agent stops. */
export type RunVerdict = "done" | "blocked" | "needs-review";
```

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0 (main.ts does not exist yet; tsc may say
"No inputs" only if src is empty — it is not, types.ts exists).

### Step 3: Write the full manifest `extension.toml`

Write it completely now (later plans only add handlers; they must not need to edit it):

```toml
id = "tasklist"
name = "Tasklist"
version = "0.1.0"
description = "Plans from the improve skill as a task list: read, edit and run them with agents."
api = "1.1"
activation = [{ workspace_contains = "plans/README.md" }]

[program]
placement = "app"
permissions = ["terminals"]
runtime = "node"
args = ["dist/main.js"]

[[contributes.command]]
id = "tasklist.open"
title = "Tasklist: Open"
icon = "tasks"

[[contributes.command]]
id = "tasklist.refresh"
title = "Tasklist: Refresh"
icon = "refresh"

[[contributes.command]]
id = "tasklist.new-task"
title = "Tasklist: New task"
icon = "add"

[[contributes.command]]
id = "tasklist.generate"
title = "Tasklist: Write plans with /improve"
icon = "magic"

[[contributes.command]]
id = "tasklist.reconcile"
title = "Tasklist: Reconcile plans with /improve"
icon = "repeat"

[[contributes.command]]
id = "tasklist.run-next"
title = "Tasklist: Run the next task"
icon = "play"

[[contributes.command]]
id = "tasklist.auto-run"
title = "Tasklist: Start an auto-run session"
icon = "flash"

[[contributes.command]]
id = "tasklist.stop"
title = "Tasklist: Stop the auto-run session"
icon = "stop"

[[contributes.menu]]
command = "tasklist.open"
target = "group"

[[contributes.menu]]
command = "tasklist.open"
target = "file"
files = ["README.md"]

[[contributes.keybinding]]
command = "tasklist.open"
macos = "cmd-alt-shift-t"
linux = "ctrl-alt-shift-t"
windows = "ctrl-alt-shift-t"

[[contributes.titlebar_item]]
id = "tasklist"
title = "Tasklist"
icon = "tasks"
side = "right"
command = "tasklist.open"

[[contributes.view]]
id = "tasklist"
title = "Tasklist"
zone = "file_tab"
icon = "tasks"

[[contributes.setting]]
key = "harness"
title = "Agent"
description = "The coding agent that runs a task."
type = "choice"
default = "claude"
options = [
  { value = "claude", label = "Claude Code" },
  { value = "codex", label = "Codex" },
  { value = "opencode", label = "opencode" },
]

[[contributes.setting]]
key = "execution-style"
title = "How an agent runs a plan"
description = "Direct: the agent follows the plan itself. Improve: the agent runs '/improve execute <plan>', which dispatches an executor and reviews its diff."
type = "choice"
default = "direct"
options = [
  { value = "direct", label = "Direct" },
  { value = "improve", label = "/improve execute" },
]

[[contributes.setting]]
key = "extra-args"
title = "Extra agent arguments"
description = "Added before the prompt, split on spaces, e.g. --model sonnet."
type = "text"
default = ""

[[contributes.setting]]
key = "max-parallel"
title = "Parallel agents in an auto-run"
description = "1 runs tasks one after another in the group folder; more runs each task in its own git worktree."
type = "number"
default = 1
min = 1
max = 8

[[contributes.setting]]
key = "stop-on-failure"
title = "Stop the auto-run when a task is blocked or needs review"
type = "toggle"
default = true

[[contributes.setting]]
key = "krad-path"
title = "Krad CLI"
description = "The krad CLI used to follow agent states, by name on PATH or as a full path."
type = "text"
default = "krad"

[[contributes.tool]]
name = "tasklist_list"
description = "List the tasks (implementation plans in plans/) of the group with their status, dependencies and plan file."
effect = "read_only"
input_schema = { type = "object", properties = {} }

[[contributes.tool]]
name = "tasklist_set_status"
description = "Set the status of one task in plans/README.md: TODO, IN PROGRESS, DONE, BLOCKED or REJECTED, with an optional one-line note."
effect = "destructive"
input_schema = { type = "object", properties = { id = { type = "string", description = "Three-digit plan id, e.g. 003." }, status = { type = "string", enum = ["TODO", "IN PROGRESS", "DONE", "BLOCKED", "REJECTED"] }, note = { type = "string", description = "One-line reason, for BLOCKED or REJECTED." } }, required = ["id", "status"] }
```

**Verify**: `node -e "const s=require('fs').readFileSync('extension.toml','utf8');for(const k of ['tasklist.open','tasklist.auto-run','tasklist_set_status','max-parallel','zone = \"file_tab\"'])if(!s.includes(k))throw k;console.log('ok')"` → `ok`.

### Step 4: Minimal `src/main.ts`

A placeholder that later plans replace. It must: read settings in `onInitialize` (ignore values for now),
register the `tasklist` view whose `render` returns
`ui.column("root", [ui.text("placeholder", "Tasklist is being built.")])`, register command
`tasklist.open` that calls `context.app.openView({ view: "tasklist", instance: root, title: "Tasklist" })`
where `root` is `target.root` when `target?.kind === "group"`, else the first group of
`await context.app.workspaceContext()` (`groups[0]?.root`), else toast `"Open a group first."` and return.
Import `Task` from `./types.js` somewhere (e.g. an unused `export type { Task }` re-export is NOT allowed —
instead just `import type { PlanSet } from "./types.js";` and type a `let current: PlanSet | null = null;`)
so the bundle proves the import path style (`.js` suffix, NodeNext) works.

**Verify**: `npm run build` → exit 0 and `ls dist/main.js` exists.

### Step 5: Program test `test/program.test.mjs`

Model it on the krad-docker pattern above (spawn `dist/main.js`, `FrameDecoder`, answer `settings/get`
with `{}`, and answer `workspace/context` with `{ groups: [] }` if the program asks). Use `api: "1.1"` in
INIT and `features: ["views", "commands", "tools"]`. Tests:
1. `initialize` replies with a `result.features` array.
2. `view/render` of `{ view: "tasklist", instance: <a temp dir> }` replies with a node whose `type` is
   `"flex"` and `key` is `"root"`.

Kill the child in `t.after`.

**Verify**: `npm test` → `ℹ fail 0`, at least 2 tests pass.

### Step 6: README and license

`README.md`: what the extension does (task list tab over `plans/`, edit, run one / parallel / auto-run),
Install (Settings → Extensions → Add folder, trust it — it declares `terminals`), the settings table
(from the manifest), and a Develop section: `npm install`, `npm test`, "commit the rebuilt `dist/`".
`LICENSE-MIT`: standard MIT text, copyright `2026 the Tasklist authors`.

**Verify**: `grep -c "npm test" README.md` → ≥ 1.

### Step 7: Commit

`git add -A && git commit -m "Scaffold the Tasklist extension for Krad ADE"` (with any trailer the
operator requires). `node_modules/` must not be committed; `dist/main.js` must be.

**Verify**: `git ls-files | grep -c node_modules` → `0`; `git ls-files dist/main.js` → `dist/main.js`.

## Test plan

- `test/program.test.mjs` with the 2 tests of step 5. Later plans add `test/plans.test.mjs`,
  `test/view.test.mjs`, `test/runner.test.mjs`.

## Done criteria

- [ ] `npm test` exits 0 with `ℹ fail 0`
- [ ] `src/types.ts` exports exactly: `TASK_STATUSES, TaskStatus, Task, PlanSet, HARNESSES, Harness, AgentState, RunMode, RunRecord, RunVerdict`
- [ ] `extension.toml` is the full manifest of step 3
- [ ] `src/plans.ts`, `src/view.ts`, `src/runner.ts`, `src/scheduler.ts` do NOT exist
- [ ] `git log --oneline | wc -l` → `1`; working tree clean (`git status --porcelain` empty)
- [ ] `plans/README.md` row 001 status is `DONE`

## STOP conditions

- `npm install` cannot fetch `@krad-ade/extension@^0.4.0` (offline / not published).
- `ui.markdown`, `ui.terminal` or `app.workspaceContext` are missing from the installed SDK's
  `node_modules/@krad-ade/extension/dist/index.d.ts` / `extension.d.ts`.
- `npm test` fails twice after a reasonable fix attempt.

## Maintenance notes

- `src/types.ts` is the contract between parallel plans 002/003/004 — change it only in a plan that
  updates every importer.
- The manifest uses `api = "1.1"` (titlebar item) and a `choice` setting. If an older Krad rejects the
  manifest, drop the `[[contributes.titlebar_item]]` block and turn `choice` settings into `text`.
- `dist/` is committed on purpose: rebuild and commit it with every `src/` change.
