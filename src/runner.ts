// Launching coding agents on tasks and following their state on the Krad agents bus.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentState, Harness, Task } from "./types.js";

const run = promisify(execFile);
const OUTPUT_LIMIT = 16 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Prompts and commands
// ---------------------------------------------------------------------------

export type ExecutionStyle = "direct" | "improve";

/** One line, no characters a Windows `cmd /c` would interpret: strip `"`, `%`, `^`, `&`, `|`, `<`, `>`, newlines. */
export function safeLine(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/["%^&|<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Prompts are plain text: a chat takes them as they are; harnessCommand makes them one safe line
// for the terminal fallback.

/** planPath is relative to the agent's working folder, with forward slashes, e.g. "plans/003-tab.md". */
export function taskPrompt(task: Task, planPath: string, style: ExecutionStyle): string {
  if (style === "improve") return `/improve execute ${planPath}`;
  return (
    `Execute the implementation plan in ${planPath}. Read it fully first, follow its steps in order, ` +
      `run every verification command, and honour its STOP conditions. When finished, set the Status cell ` +
      `of row ${task.id} in plans/README.md to DONE, or to BLOCKED (one-line reason) if you stopped. ` +
      `Change no other row.`
  );
}

/**
 * A prompt that asks an agent to change one plan file as the user describes, without
 * carrying the plan out. planPath is relative to the group folder, with forward slashes.
 */
export function editPlanPrompt(planPath: string, instruction: string): string {
  return (
    `Edit the implementation plan in ${planPath}. The change: ${instruction.trim()} ` +
      `Read the plan fully first. Change only what the request needs and keep the plan's format: the ` +
      `'# Plan NNN: title' heading, the ## Status section and the numbered steps. Do not carry out the plan ` +
      `and do not change code. If the change touches the title, priority, effort or dependencies, update the ` +
      `plan's row in plans/README.md to match, leaving its Status cell and every other row alone.`
  );
}

export function improvePrompt(args: string): string {
  return `/improve ${args.trim()}`.trim();
}

export interface TerminalSpec {
  program: string;
  args: string[];
}

function splitArgs(extraArgs: string): string[] {
  return extraArgs.split(/\s+/).filter((part) => part.length > 0);
}

/** Harness command for a prompt (made one safeLine for `cmd /c`); extraArgs is the user's setting split on whitespace. platform defaults to process.platform. */
export function harnessCommand(
  harness: Harness,
  prompt: string,
  extraArgs: string,
  platform: NodeJS.Platform = process.platform,
): TerminalSpec {
  const extra = splitArgs(extraArgs);
  const line = safeLine(prompt);
  const promptArgs = harness === "opencode" ? ["--prompt", line] : [line];
  const program = harness;
  const rest = [...extra, ...promptArgs];
  if (platform === "win32") return { program: "cmd.exe", args: ["/d", "/s", "/c", program, ...rest] };
  return { program, args: rest };
}

/** krad variants run with 2–4 harnesses (throws RangeError otherwise). program is "krad". */
export function variantsCommand(
  harnesses: Harness[],
  prompt: string,
  platform: NodeJS.Platform = process.platform,
): TerminalSpec {
  if (harnesses.length < 2 || harnesses.length > 4) {
    throw new RangeError(`krad variants run needs 2 to 4 agents, got ${harnesses.length}`);
  }
  // krad.exe is a real executable on Windows: no cmd wrapper needed.
  void platform;
  const args = ["variants", "run"];
  for (const harness of harnesses) args.push("--variant", harness);
  args.push(prompt);
  return { program: "krad", args };
}

// ---------------------------------------------------------------------------
// Worktrees
// ---------------------------------------------------------------------------

/** The worktree name of a task: <id>-<slug>. */
export function worktreeName(task: Task): string {
  return `${task.id}-${task.slug}`;
}

/** <root>.worktrees/<name>: where both Krad's chat/open and createWorktree put a worktree. */
export function worktreePath(root: string, name: string): string {
  return join(`${root.replace(/[\\/]+$/, "")}.worktrees`, name);
}

export function worktreeFor(root: string, task: Task): { path: string; branch: string } {
  const name = worktreeName(task);
  return { path: worktreePath(root, name), branch: `tasklist/${name}` };
}

export async function isGitRepo(root: string, git = "git"): Promise<boolean> {
  try {
    const { stdout } = await run(git, ["-C", root, "rev-parse", "--is-inside-work-tree"], { windowsHide: true });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const full = resolve(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? full.toLowerCase() : full;
  };
  return norm(a) === norm(b);
}

async function gitOutput(git: string, args: string[]): Promise<string> {
  const { stdout } = await run(git, args, { maxBuffer: OUTPUT_LIMIT, windowsHide: true });
  return stdout;
}

async function branchExists(root: string, branch: string, git: string): Promise<boolean> {
  try {
    await gitOutput(git, ["-C", root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function createWorktree(
  root: string,
  task: Task,
  git = "git",
): Promise<{ path: string; branch: string }> {
  const target = worktreeFor(root, task);
  if (existsSync(target.path)) {
    const listing = await gitOutput(git, ["-C", root, "worktree", "list", "--porcelain"]);
    const known = listing
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length));
    if (known.some((path) => samePath(path, target.path))) return target;
  }
  if (await branchExists(root, target.branch, git)) {
    await gitOutput(git, ["-C", root, "worktree", "add", target.path, target.branch]);
  } else {
    await gitOutput(git, ["-C", root, "worktree", "add", "-b", target.branch, target.path]);
  }
  return target;
}

// ---------------------------------------------------------------------------
// Agents bus
// ---------------------------------------------------------------------------

export interface AgentInfo {
  environment: string;
  terminal: number;
  state: AgentState;
  title: string;
  harness: string | null;
  group: string | null;
}

export interface KradCli {
  program: string;
  prefixArgs: string[];
}

const AGENT_STATES: readonly AgentState[] = ["idle", "working", "waiting-for-input", "done", "exited", "closed"];

function toState(value: unknown): AgentState {
  return AGENT_STATES.includes(value as AgentState) ? (value as AgentState) : "idle";
}

function toAgent(raw: unknown): AgentInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.terminal !== "number") return null;
  return {
    environment: typeof r.environment === "string" ? r.environment : "main",
    terminal: r.terminal,
    state: toState(r.state),
    title: typeof r.title === "string" ? r.title : "",
    harness: typeof r.harness === "string" ? r.harness : null,
    group: typeof r.group === "string" ? r.group : null,
  };
}

function toAgents(list: unknown): AgentInfo[] {
  if (!Array.isArray(list)) return [];
  return list.map(toAgent).filter((a): a is AgentInfo => a !== null);
}

/** First that answers `--version` among: the setting, "krad", "krad-ade-agents", and on win32
 *  %LOCALAPPDATA%\Programs\Krad ADE\krad.exe. null when none. */
export async function findKrad(setting: string): Promise<KradCli | null> {
  const candidates: string[] = [];
  if (setting.trim()) candidates.push(setting.trim());
  candidates.push("krad", "krad-ade-agents");
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, "Programs", "Krad ADE", "krad.exe"));
  }
  for (const program of [...new Set(candidates)]) {
    try {
      await run(program, ["--version"], { timeout: 5000, windowsHide: true });
      return { program, prefixArgs: [] };
    } catch {
      // try the next one
    }
  }
  return null;
}

export async function listAgents(cli: KradCli): Promise<AgentInfo[]> {
  const { stdout } = await run(cli.program, [...cli.prefixArgs, "list", "--json"], {
    maxBuffer: OUTPUT_LIMIT,
    windowsHide: true,
  });
  const parsed = JSON.parse(stdout) as { Agents?: unknown };
  return toAgents(parsed.Agents);
}

/** Parses one line of `agents watch --json`: a snapshot yields every agent, an event yields one; else []. */
export function parseWatchLine(line: string): { snapshot: boolean; agents: AgentInfo[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { snapshot: false, agents: [] };
  }
  if (!parsed || typeof parsed !== "object") return { snapshot: false, agents: [] };
  const message = parsed as Record<string, unknown>;
  const snapshot = message.AgentSnapshot as Record<string, unknown> | undefined;
  if (snapshot && typeof snapshot === "object") return { snapshot: true, agents: toAgents(snapshot.agents) };
  const agent = toAgent(message.AgentEvent);
  return { snapshot: false, agents: agent ? [agent] : [] };
}

const FIRST_DELAY_MS = 2000;
const MAX_DELAY_MS = 60_000;

export class AgentWatcher {
  private child: ChildProcess | null = null;
  private stopped = true;
  private delay = FIRST_DELAY_MS;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private cli: KradCli,
    private onChange: (agent: AgentInfo, snapshot: boolean) => void,
    private log: (message: string) => void = () => {},
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.delay = FIRST_DELAY_MS;
    this.launch();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) child.kill();
  }

  private safeLog(message: string): void {
    try {
      this.log(message);
    } catch {
      // never throw from callbacks
    }
  }

  private launch(): void {
    let child: ChildProcess;
    try {
      child = spawn(this.cli.program, [...this.cli.prefixArgs, "agents", "watch", "--json"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      this.safeLog(`krad agents watch failed to start: ${String(error)}`);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    let rest = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      rest += chunk;
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) this.handleLine(line);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      const text = chunk.trim();
      if (text) this.safeLog(`krad agents watch: ${text}`);
    });
    child.on("error", (error) => {
      this.safeLog(`krad agents watch error: ${error.message}`);
    });
    child.stdout?.on("end", () => {
      if (rest.trim()) this.handleLine(rest);
      rest = "";
    });
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopped) return;
      this.safeLog(`krad agents watch exited (code ${code ?? "null"}); restarting in ${this.delay / 1000}s`);
      this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    if (this.stopped) return;
    const wait = this.delay;
    this.delay = Math.min(this.delay * 2, MAX_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.launch();
    }, wait);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.delay = FIRST_DELAY_MS;
    const { snapshot, agents } = parseWatchLine(trimmed);
    for (const agent of agents) {
      try {
        this.onChange(agent, snapshot);
      } catch (error) {
        this.safeLog(`agent watcher callback failed: ${String(error)}`);
      }
    }
  }
}
