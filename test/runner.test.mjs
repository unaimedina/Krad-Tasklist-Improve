import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentWatcher,
  createWorktree,
  harnessCommand,
  listAgents,
  parseWatchLine,
  safeLine,
  editPlanPrompt,
  taskPrompt,
  variantsCommand,
  worktreeFor,
} from "../dist/runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fakePath = join(here, "fixtures", "fake-krad.mjs");
const fakeCli = { program: process.execPath, prefixArgs: [fakePath] };

function task(id, slug) {
  return {
    id,
    slug,
    file: `/x/plans/${id}-${slug}.md`,
    title: slug,
    priority: "P1",
    effort: "S",
    risk: "LOW",
    dependsOn: [],
    status: "TODO",
    statusNote: null,
  };
}

test("taskPrompt builds a one-line direct prompt and the improve prompt", () => {
  const direct = taskPrompt(task("003", "x"), "plans/003-x.md", "direct");
  assert.match(direct, /plans\/003-x\.md/);
  assert.match(direct, /plans\/README\.md/);
  assert.match(direct, /row 003/);
  assert.ok(!direct.includes('"'));
  assert.ok(!direct.includes("\n"));
  assert.equal(taskPrompt(task("003", "x"), "plans/003-x.md", "improve"), "/improve execute plans/003-x.md");
});

test("safeLine strips characters cmd /c would interpret", () => {
  const out = safeLine('a "b" & c | d\n%x%');
  for (const ch of ['"', "&", "|", "%", "\n"]) assert.ok(!out.includes(ch), `contains ${JSON.stringify(ch)}`);
});

test("harnessCommand on linux and win32", () => {
  assert.deepEqual(harnessCommand("claude", "p", "--model sonnet", "linux"), {
    program: "claude",
    args: ["--model", "sonnet", "p"],
  });
  assert.deepEqual(harnessCommand("codex", "p", "--model sonnet", "linux"), {
    program: "codex",
    args: ["--model", "sonnet", "p"],
  });
  assert.deepEqual(harnessCommand("opencode", "p", "--model sonnet", "linux"), {
    program: "opencode",
    args: ["--model", "sonnet", "--prompt", "p"],
  });
  assert.deepEqual(harnessCommand("claude", "p", "--model sonnet", "win32"), {
    program: "cmd.exe",
    args: ["/d", "/s", "/c", "claude", "--model", "sonnet", "p"],
  });
  assert.deepEqual(harnessCommand("codex", "p", "--model sonnet", "win32"), {
    program: "cmd.exe",
    args: ["/d", "/s", "/c", "codex", "--model", "sonnet", "p"],
  });
  assert.deepEqual(harnessCommand("opencode", "p", "--model sonnet", "win32"), {
    program: "cmd.exe",
    args: ["/d", "/s", "/c", "opencode", "--model", "sonnet", "--prompt", "p"],
  });
  assert.deepEqual(harnessCommand("claude", "p", "  ", "linux").args, ["p"]);
});

test("variantsCommand needs 2 to 4 harnesses", () => {
  assert.deepEqual(variantsCommand(["claude", "codex"], "p", "win32"), {
    program: "krad",
    args: ["variants", "run", "--variant", "claude", "--variant", "codex", "p"],
  });
  assert.throws(() => variantsCommand(["claude"], "p"), RangeError);
  assert.throws(() => variantsCommand(["claude", "codex", "opencode", "claude", "codex"], "p"), RangeError);
});

test("worktreeFor names the worktree next to the repository", () => {
  const wt = worktreeFor("/src/app", task("003", "tab"));
  assert.ok(wt.path.endsWith(join("app.worktrees", "003-tab")), wt.path);
  assert.equal(wt.path, join("/src/app.worktrees", "003-tab"));
  assert.equal(worktreeFor("/src/app/", task("003", "tab")).path, wt.path);
  assert.equal(wt.branch, "tasklist/003-tab");
});

test("createWorktree creates a worktree and reuses it", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "tasklist-runner-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "repo");
  const git = (...args) => execFileSync("git", args, { cwd: base, encoding: "utf8" });
  git("init", "-q", root);
  writeFileSync(join(root, "a.txt"), "a\n");
  git("-C", root, "add", "a.txt");
  git("-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");

  const created = await createWorktree(root, task("003", "tab"));
  assert.equal(created.branch, "tasklist/003-tab");
  assert.ok(existsSync(join(created.path, "a.txt")));
  assert.match(git("-C", root, "branch", "--list", "tasklist/003-tab"), /tasklist\/003-tab/);

  const again = await createWorktree(root, task("003", "tab"));
  assert.deepEqual(again, created);

  // Branch exists but worktree folder is gone: attaches the existing branch.
  git("-C", root, "worktree", "remove", "--force", created.path);
  const reattached = await createWorktree(root, task("003", "tab"));
  assert.ok(existsSync(join(reattached.path, "a.txt")));
});

test("parseWatchLine reads snapshots, events and ignores garbage", () => {
  const snap = parseWatchLine(
    JSON.stringify({
      AgentSnapshot: {
        stream: "s",
        seq: 1,
        at: "t",
        resync: false,
        agents: [
          { environment: "main", terminal: 2, title: "a", group: "g", state: "working", harness: "Claude Code", is_self: false },
          { environment: "main", terminal: 3, title: "b", group: null, state: "weird", harness: null, is_self: false },
        ],
      },
    }),
  );
  assert.equal(snap.snapshot, true);
  assert.deepEqual(
    snap.agents.map((a) => [a.terminal, a.state, a.group, a.harness]),
    [
      [2, "working", "g", "Claude Code"],
      [3, "idle", null, null],
    ],
  );

  const event = parseWatchLine(
    JSON.stringify({
      AgentEvent: {
        seq: 42, kind: "state_changed", environment: "main", terminal: 4, title: "t", group: "api",
        harness: "Claude Code", previous: "working", state: "done", coarse_state: "idle", reason: "turn_finished",
      },
    }),
  );
  assert.equal(event.snapshot, false);
  assert.deepEqual(event.agents, [
    { environment: "main", terminal: 4, state: "done", title: "t", harness: "Claude Code", group: "api" },
  ]);

  assert.deepEqual(parseWatchLine("not json").agents, []);
  assert.deepEqual(parseWatchLine("[1,2]").agents, []);
  assert.deepEqual(parseWatchLine('{"Other":{}}').agents, []);
});

test("listAgents parses the fake CLI", async () => {
  const agents = await listAgents(fakeCli);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].terminal, 7);
  assert.equal(agents[0].state, "working");
});

test("AgentWatcher reports working then done", async (t) => {
  const seen = [];
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const watcher = new AgentWatcher(fakeCli, (agent, snapshot) => {
    seen.push([agent.terminal, agent.state, snapshot]);
    if (agent.state === "done") resolveDone();
  });
  t.after(() => watcher.stop());
  watcher.start();
  await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))]);
  assert.deepEqual(seen.slice(0, 2), [
    [7, "working", true],
    [7, "done", false],
  ]);
});

test("editPlanPrompt asks for one change to one plan file, on one safe line", () => {
  const prompt = editPlanPrompt("plans/005-wire.md", 'Split step 3 in two\nand add a "test" & more');
  assert.ok(!/[\r\n"&|<>%^]/.test(prompt), prompt);
  assert.match(prompt, /^Edit the implementation plan in plans\/005-wire\.md\. The change: Split step 3 in two and add a test more /);
  assert.match(prompt, /'# Plan NNN: title' heading/);
  assert.match(prompt, /Do not carry out the plan and do not change code\./);
  assert.match(prompt, /leaving its Status cell and every other row alone\.$/);
});
