// src/runner.ts
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
var run = promisify(execFile);
var OUTPUT_LIMIT = 16 * 1024 * 1024;
function safeLine(text) {
  return text.replace(/[\r\n]+/g, " ").replace(/["%^&|<>]/g, "").replace(/\s+/g, " ").trim();
}
function taskPrompt(task, planPath, style) {
  if (style === "improve") return safeLine(`/improve execute ${planPath}`);
  return safeLine(
    `Execute the implementation plan in ${planPath}. Read it fully first, follow its steps in order, run every verification command, and honour its STOP conditions. When finished, set the Status cell of row ${task.id} in plans/README.md to DONE, or to BLOCKED (one-line reason) if you stopped. Change no other row.`
  );
}
function editPlanPrompt(planPath, instruction) {
  return safeLine(
    `Edit the implementation plan in ${planPath}. The change: ${instruction} Read the plan fully first. Change only what the request needs and keep the plan's format: the '# Plan NNN: title' heading, the ## Status section and the numbered steps. Do not carry out the plan and do not change code. If the change touches the title, priority, effort or dependencies, update the plan's row in plans/README.md to match, leaving its Status cell and every other row alone.`
  );
}
function improvePrompt(args) {
  return safeLine(`/improve ${args.trim()}`);
}
function splitArgs(extraArgs) {
  return extraArgs.split(/\s+/).filter((part) => part.length > 0);
}
function harnessCommand(harness, prompt, extraArgs, platform = process.platform) {
  const extra = splitArgs(extraArgs);
  const promptArgs = harness === "opencode" ? ["--prompt", prompt] : [prompt];
  const program = harness;
  const rest = [...extra, ...promptArgs];
  if (platform === "win32") return { program: "cmd.exe", args: ["/d", "/s", "/c", program, ...rest] };
  return { program, args: rest };
}
function variantsCommand(harnesses, prompt, platform = process.platform) {
  if (harnesses.length < 2 || harnesses.length > 4) {
    throw new RangeError(`krad variants run needs 2 to 4 agents, got ${harnesses.length}`);
  }
  void platform;
  const args = ["variants", "run"];
  for (const harness of harnesses) args.push("--variant", harness);
  args.push(prompt);
  return { program: "krad", args };
}
function worktreeFor(root, task) {
  const trimmed = root.replace(/[\\/]+$/, "");
  const name = `${task.id}-${task.slug}`;
  return { path: join(`${trimmed}.worktrees`, name), branch: `tasklist/${name}` };
}
async function isGitRepo(root, git = "git") {
  try {
    const { stdout } = await run(git, ["-C", root, "rev-parse", "--is-inside-work-tree"], { windowsHide: true });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}
function samePath(a, b) {
  const norm = (p) => {
    const full = resolve(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? full.toLowerCase() : full;
  };
  return norm(a) === norm(b);
}
async function gitOutput(git, args) {
  const { stdout } = await run(git, args, { maxBuffer: OUTPUT_LIMIT, windowsHide: true });
  return stdout;
}
async function branchExists(root, branch, git) {
  try {
    await gitOutput(git, ["-C", root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}
async function createWorktree(root, task, git = "git") {
  const target = worktreeFor(root, task);
  if (existsSync(target.path)) {
    const listing = await gitOutput(git, ["-C", root, "worktree", "list", "--porcelain"]);
    const known = listing.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
    if (known.some((path) => samePath(path, target.path))) return target;
  }
  if (await branchExists(root, target.branch, git)) {
    await gitOutput(git, ["-C", root, "worktree", "add", target.path, target.branch]);
  } else {
    await gitOutput(git, ["-C", root, "worktree", "add", "-b", target.branch, target.path]);
  }
  return target;
}
var AGENT_STATES = ["idle", "working", "waiting-for-input", "done", "exited", "closed"];
function toState(value) {
  return AGENT_STATES.includes(value) ? value : "idle";
}
function toAgent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw;
  if (typeof r.terminal !== "number") return null;
  return {
    environment: typeof r.environment === "string" ? r.environment : "main",
    terminal: r.terminal,
    state: toState(r.state),
    title: typeof r.title === "string" ? r.title : "",
    harness: typeof r.harness === "string" ? r.harness : null,
    group: typeof r.group === "string" ? r.group : null
  };
}
function toAgents(list) {
  if (!Array.isArray(list)) return [];
  return list.map(toAgent).filter((a) => a !== null);
}
async function findKrad(setting) {
  const candidates = [];
  if (setting.trim()) candidates.push(setting.trim());
  candidates.push("krad", "krad-ade-agents");
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, "Programs", "Krad ADE", "krad.exe"));
  }
  for (const program of [...new Set(candidates)]) {
    try {
      await run(program, ["--version"], { timeout: 5e3, windowsHide: true });
      return { program, prefixArgs: [] };
    } catch {
    }
  }
  return null;
}
async function listAgents(cli) {
  const { stdout } = await run(cli.program, [...cli.prefixArgs, "list", "--json"], {
    maxBuffer: OUTPUT_LIMIT,
    windowsHide: true
  });
  const parsed = JSON.parse(stdout);
  return toAgents(parsed.Agents);
}
function parseWatchLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { snapshot: false, agents: [] };
  }
  if (!parsed || typeof parsed !== "object") return { snapshot: false, agents: [] };
  const message = parsed;
  const snapshot = message.AgentSnapshot;
  if (snapshot && typeof snapshot === "object") return { snapshot: true, agents: toAgents(snapshot.agents) };
  const agent = toAgent(message.AgentEvent);
  return { snapshot: false, agents: agent ? [agent] : [] };
}
var FIRST_DELAY_MS = 2e3;
var MAX_DELAY_MS = 6e4;
var AgentWatcher = class {
  constructor(cli, onChange, log = () => {
  }) {
    this.cli = cli;
    this.onChange = onChange;
    this.log = log;
  }
  child = null;
  stopped = true;
  delay = FIRST_DELAY_MS;
  timer = null;
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.delay = FIRST_DELAY_MS;
    this.launch();
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) child.kill();
  }
  safeLog(message) {
    try {
      this.log(message);
    } catch {
    }
  }
  launch() {
    let child;
    try {
      child = spawn(this.cli.program, [...this.cli.prefixArgs, "agents", "watch", "--json"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      this.safeLog(`krad agents watch failed to start: ${String(error)}`);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    let rest = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      rest += chunk;
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) this.handleLine(line);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
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
      this.safeLog(`krad agents watch exited (code ${code ?? "null"}); restarting in ${this.delay / 1e3}s`);
      this.scheduleRestart();
    });
  }
  scheduleRestart() {
    if (this.stopped) return;
    const wait = this.delay;
    this.delay = Math.min(this.delay * 2, MAX_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.launch();
    }, wait);
  }
  handleLine(line) {
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
};
export {
  AgentWatcher,
  createWorktree,
  editPlanPrompt,
  findKrad,
  harnessCommand,
  improvePrompt,
  isGitRepo,
  listAgents,
  parseWatchLine,
  safeLine,
  taskPrompt,
  variantsCommand,
  worktreeFor
};
