# Plan 004: Launch agents on tasks and follow their state (`src/runner.ts`)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git log --oneline -1` must show plan 001's scaffold commit and
> `src/types.ts` must export `RunRecord`, `Harness`, `AgentState`, `Task`. If not, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-scaffold-extension.md
- **Category**: direction
- **Planned at**: no commit (planned before plan 001 created the repo), 2026-11-18

## Why this matters

Running a task means starting a coding agent (Claude Code, Codex, opencode) on its plan, where the user
can watch it, and knowing when it stops so the task list and the auto-run session can move on. This plan
writes the module that builds the agent's prompt and terminal command, makes a git worktree for parallel
runs, prepares a Krad *variants* run, and follows agent states from Krad's agents bus.

## Current state — the facts this design rests on

- Plan 001 created the project; read `src/types.ts` (`Task`, `RunRecord`, `Harness`, `AgentState`,
  `RunMode`). Do not change it. Plans 002/003 are written in parallel: do NOT import `./plans.js` or
  `./view.js`.
- **Extensions cannot spawn agents directly.** The SDK (`@krad-ade/extension@0.4.0`) has no agent API.
  What it has: `app.openTerminal({ title, command: { program, args, env }, cwd, zone: "session" | "utilities" | "view" }) → Promise<number>`
  (needs the `terminals` permission, declared in `extension.toml`). Krad recognises a harness running in
  a terminal as an **agent** and lists it on its agents bus.
- **The agents bus** (Krad "Agents API v1") is reached with the `krad` CLI (`krad.exe` / `krad-ade-agents.exe`,
  same program; on this machine in `%LOCALAPPDATA%\Programs\Krad ADE\`). The extension program runs
  outside the app's terminals, so the CLI talks as a `"Client"`: it may only **list and watch** agents.
  Output, verified on this machine with Krad 0.4.2:
  ```
  $ krad list --json
  {"Agents":[{"environment":"main","terminal":2,"title":"New chat · 2","group":"Krad-Tasklist-Improve","state":"working","harness":"Claude Code","is_self":true}]}
  ```
  `krad agents watch --json` (documented, not yet run here) prints one JSON object per line, first an
  `{"AgentSnapshot":{"stream","seq","at","resync","agents":[...same shape as above...]}}`, then events:
  `{"AgentEvent":{"seq":42,"kind":"state_changed","environment":"main","terminal":4,"title":"...","group":"api","harness":"Claude Code","previous":"working","state":"done","coarse_state":"idle","reason":"turn_finished"}}`.
  `kind` is `opened`, `state_changed` or `closed`; `state` is `idle | working | waiting-for-input | done | exited | closed`.
  The command exits with code 2 when the app is gone.
- **Inside** a terminal the app opens, `krad` is on `PATH` and calls as that terminal, which may run
  `krad variants run --variant <agent> [--model M] [--instruction TEXT] ... [--test TASK] <task>`
  (two to four `--variant`; `agent` is `claude`, `codex`, `opencode`). So variants runs are started by
  opening a terminal that runs that command.
- **Worktrees**: Krad names worktrees `<repo>.worktrees/<name>` next to the repository
  (e.g. `/src/app.worktrees/fix-login`, branch `fix-login`). Follow that.
- **Harness CLIs** (interactive, prompt as argument): `claude "<prompt>"`, `codex "<prompt>"`,
  `opencode --prompt "<prompt>"`. On Windows `claude`/`opencode` are npm `.cmd` shims, which a terminal
  cannot start by bare name, so on `win32` wrap the command as `cmd.exe /d /s /c <program> <args...>`.
- **The prompt for a task** (improve skill convention: the executor reads the plan, honours its STOP
  conditions and updates its row in `plans/README.md`).
- Exemplar for child processes (krad-docker `src/docker.ts`):
  ```ts
  import { execFile, spawn, type ChildProcess } from "node:child_process";
  import { promisify } from "node:util";
  const run = promisify(execFile);
  export class Docker {
    constructor(public program: string) {}
    private async output(args: string[]): Promise<string> {
      const { stdout } = await run(this.program, args, { maxBuffer: OUTPUT_LIMIT });
      return stdout;
    }
  }
  // streaming: spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] }) and split chunks on "\n",
  // keeping the unfinished tail in a `rest` variable between chunks.
  ```

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Build + tests | `npm test` | `ℹ fail 0` |
| This plan's tests | `npm run build && node --test test/runner.test.mjs` | all pass |
| Real CLI smoke (read-only) | `krad list --json` | one JSON line with `"Agents"` |

## Scope

**In scope**: `src/runner.ts` (create), `test/runner.test.mjs` (create), `test/fixtures/fake-krad.mjs`
(create), `package.json` (only the `bundle` line), `dist/**`, row 004 of `plans/README.md`.

**Out of scope**: `src/types.ts`, `src/main.ts`, `src/plans.ts`, `src/view.ts`, `extension.toml`.
Do not open terminals or start agents for real during this plan (no app here); do not run
`krad spawn`/`send`/`close` (lead-only, and not ours).

## Git workflow

Stay on your worktree branch; commit as `Launch agents on tasks and follow their state`. No push/merge.

## Steps

### Step 1: Bundle library modules for tests

Set `bundle` to `esbuild src/*.ts --bundle --platform=node --format=esm --target=node20 --outdir=dist`
(same one-line change as plans 002/003; keep it if already so).

**Verify**: `npm run build && ls dist/types.js` → exists.

### Step 2: Prompts and commands (pure functions)

In `src/runner.ts` export:

```ts
export type ExecutionStyle = "direct" | "improve";

/** One line, no characters a Windows `cmd /c` would interpret: strip `"`, `%`, `^`, `&`, `|`, `<`, `>`, newlines. */
export function safeLine(text: string): string;

/** planPath is relative to the agent's working folder, with forward slashes, e.g. "plans/003-tab.md". */
export function taskPrompt(task: Task, planPath: string, style: ExecutionStyle): string;
```
`direct` → `Execute the implementation plan in <planPath>. Read it fully first, follow its steps in order, run every verification command, and honour its STOP conditions. When finished, set the Status cell of row <id> in plans/README.md to DONE, or to BLOCKED (one-line reason) if you stopped. Change no other row.`
`improve` → `/improve execute <planPath>`.
Both pass through `safeLine`.

```ts
export function improvePrompt(args: string): string;            // "/improve " + args, trimmed, safeLine
export interface TerminalSpec { program: string; args: string[] }
/** Harness command for a prompt; extraArgs is the user's setting split on whitespace. platform defaults to process.platform. */
export function harnessCommand(harness: Harness, prompt: string, extraArgs: string, platform?: NodeJS.Platform): TerminalSpec;
/** krad variants run with 2–4 harnesses (throws RangeError otherwise). program is "krad". */
export function variantsCommand(harnesses: Harness[], prompt: string, platform?: NodeJS.Platform): TerminalSpec;
```
`harnessCommand`: claude → `["claude", ...extra, prompt]`, codex → `["codex", ...extra, prompt]`,
opencode → `["opencode", ...extra, "--prompt", prompt]`; on `win32` return
`{ program: "cmd.exe", args: ["/d", "/s", "/c", <program>, ...rest] }`, else `{ program, args: rest }`.
`variantsCommand`: `["variants", "run", "--variant", h1, "--variant", h2, ..., prompt]` with program
`krad` (on win32 `krad.exe` is a real exe: no cmd wrapper).

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Worktrees

```ts
export function worktreeFor(root: string, task: Task): { path: string; branch: string };
// path = `${root without trailing separator}.worktrees/${task.id}-${task.slug}` (path.join semantics);
// branch = `tasklist/${task.id}-${task.slug}`
export async function isGitRepo(root: string, git?: string): Promise<boolean>;
// git -C root rev-parse --is-inside-work-tree → "true"; any error → false
export async function createWorktree(root: string, task: Task, git?: string): Promise<{ path: string; branch: string }>;
// if the path exists and is already a worktree of root (listed by `git -C root worktree list --porcelain`), reuse it;
// else `git -C root worktree add -b <branch> <path>`; if the branch exists, `git -C root worktree add <path> <branch>`.
```

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Following agent states

```ts
export interface AgentInfo { environment: string; terminal: number; state: AgentState; title: string; harness: string | null; group: string | null }
export interface KradCli { program: string; prefixArgs: string[] }   // prefixArgs lets tests run "node fake-krad.mjs"
/** First that answers `--version` among: the setting, "krad", "krad-ade-agents", and on win32
 *  %LOCALAPPDATA%\Programs\Krad ADE\krad.exe. null when none. */
export async function findKrad(setting: string): Promise<KradCli | null>;
export async function listAgents(cli: KradCli): Promise<AgentInfo[]>;   // `list --json`, parse {"Agents":[...]}
/** Parses one line of `agents watch --json`: a snapshot yields every agent, an event yields one; else []. */
export function parseWatchLine(line: string): { snapshot: boolean; agents: AgentInfo[] };

export class AgentWatcher {
  constructor(cli: KradCli, onChange: (agent: AgentInfo, snapshot: boolean) => void, log?: (message: string) => void);
  start(): void;    // spawn `agents watch --json`; split stdout on "\n"; call onChange per agent
  stop(): void;     // kill the child, no restart
  // If the child exits while not stopped: restart after 2s, then 4s, 8s ... capped at 60s; reset the
  // delay after a line arrives. Never throw from callbacks; log instead.
}
```

Map unknown `state` strings to `"idle"`. Use `spawn(cli.program, [...cli.prefixArgs, "agents", "watch", "--json"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })`.

**Verify**: `npm run typecheck` → exit 0. Then a read-only smoke against the real app:
`node -e "import('./dist/runner.js').then(async m=>{const c=await m.findKrad('krad');console.log(c&&c.program);console.log((await m.listAgents(c)).length>=0)})"` → prints a program path/name and `true`.
(If no Krad app is running, `listAgents` may reject — that is acceptable; note it in the report.)

### Step 5: Fake CLI and tests

`test/fixtures/fake-krad.mjs` (run as `node fake-krad.mjs <args>`): `--version` → prints `0.0.0`;
`list --json` → prints `{"Agents":[{"environment":"main","terminal":7,"title":"Claude Code · 7","group":"g","state":"working","harness":"Claude Code","is_self":false}]}`;
`agents watch --json` → prints a snapshot with terminal 7 `working`, waits 50 ms, prints a
`state_changed` event 7 → `done`, then exits 0.

`test/runner.test.mjs` (import `../dist/runner.js`):
1. `taskPrompt` direct mentions the plan path, `plans/README.md`, the id, has no `"` or newline; improve
   style is exactly `/improve execute plans/003-x.md`.
2. `safeLine('a "b" & c | d\n%x%')` contains none of `" & | % \n`.
3. `harnessCommand` for each harness on `linux` and on `win32` (cmd wrapper shape), with extra args
   `--model sonnet` placed before the prompt.
4. `variantsCommand(["claude","codex"], "p")` args; a single harness throws `RangeError`.
5. `worktreeFor("/src/app", {id:"003", slug:"tab", ...})` → path ends with `app.worktrees/003-tab`
   (compare with `path.join`), branch `tasklist/003-tab`.
6. `createWorktree` on a temp git repo (`git init`, one commit with `-c user.email=t@t -c user.name=t`)
   creates the worktree folder and the branch; calling it again reuses it without throwing.
7. `parseWatchLine` for a snapshot, an event, and garbage (`[]`).
8. `AgentWatcher` with `{ program: process.execPath, prefixArgs: [fakePath] }` reports terminal 7
   `working` then `done`; call `stop()` in `t.after`.

**Verify**: `node --test test/runner.test.mjs` → ≥ 8 pass; `npm test` → `ℹ fail 0`.

### Step 6: Commit

**Verify**: `git status --porcelain` → empty.

## Test plan

Step 5. The fake CLI keeps tests independent of a running Krad and works on Windows (no shell scripts,
no `PATH` tricks — krad-docker's `PATH="$fakeBin:$PATH"` approach breaks on Windows).

## Done criteria

- [ ] `npm test` exits 0
- [ ] `grep -cE "plans\.js|view\.js" src/runner.ts` → `0`
- [ ] No in-repo calls of `krad spawn|send|close` (`grep -cE "\"(spawn|send|close)\"" src/runner.ts` → `0`)
- [ ] Only in-scope files changed vs. `main`
- [ ] Row 004 in `plans/README.md` is `DONE`

## STOP conditions

- `krad agents watch --json` (try it for 3 s with a timeout, read-only) prints something that is not one
  JSON object per line in the shapes above — report the real shape instead of guessing.
- You need to change `src/types.ts`.
- A test needs network or a running Krad app.

## Maintenance notes

- Assumption to verify in plan 005 inside the real app: the number `app.openTerminal` returns equals the
  bus `terminal` id of that agent. If not, plan 005 matches runs by terminal **title** instead (the
  runner opens terminals with unique titles `task <id> · <harness>`).
- SDK ≥ 0.5 adds `events/subscribe` (app events `agent_started/agent_waiting/agent_finished`); when the
  extension moves to it, `AgentWatcher` can be replaced by `onAppEvent` without the CLI.
- Prompts are kept single-line on purpose (Windows `cmd /c` quoting). Put detail in plan files, never
  in prompts.
