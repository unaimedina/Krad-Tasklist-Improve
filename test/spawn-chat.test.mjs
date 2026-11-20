import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helper = join(root, "dist", "spawn-chat.js");

/** A fake krad (run as `node fake-krad.mjs ...`): records its args, then answers like `krad spawn --json`. */
const FAKE_KRAD = `
import { writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_KRAD_ARGS, JSON.stringify(process.argv.slice(2)));
if (process.env.FAKE_KRAD_FAIL) {
  console.error("spawn: not running inside a Krad terminal");
  process.exit(2);
}
console.log(JSON.stringify({ Spawned: { terminal: 42 } }));
`;

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "spawn-chat-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = join(dir, "fake-krad.mjs");
  writeFileSync(fake, FAKE_KRAD);
  return { dir, fake, argsFile: join(dir, "args.json"), out: join(dir, "out.json") };
}

function runHelper(dir, request, env) {
  const file = join(dir, "request.json");
  writeFileSync(file, JSON.stringify(request));
  return spawnSync(process.execPath, [helper, file], { encoding: "utf8", env: { ...process.env, ...env } });
}

test("spawn-chat runs krad spawn with the agent, worktree and the task intact, and writes ok + terminal", (t) => {
  const { dir, fake, argsFile, out } = setup(t);
  const task = 'Edit the plan.\nThe change: say "hi" & <more> | 100%';
  const run = runHelper(
    dir,
    { krad: process.execPath, kradArgs: [fake], agent: "codex", worktree: "005-five", task, out },
    { FAKE_KRAD_ARGS: argsFile },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Started a codex chat \(terminal 42\)/);
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), { ok: true, terminal: 42 });
  assert.deepEqual(JSON.parse(readFileSync(argsFile, "utf8")), [
    "spawn",
    "--json",
    "--agent",
    "codex",
    "--worktree",
    "005-five",
    task,
  ]);
});

test("spawn-chat reports krad's error, exits 1, and leaves out --worktree when there is none", (t) => {
  const { dir, fake, argsFile, out } = setup(t);
  const run = runHelper(
    dir,
    { krad: process.execPath, kradArgs: [fake], agent: "claude", worktree: null, task: "/improve", out },
    { FAKE_KRAD_ARGS: argsFile, FAKE_KRAD_FAIL: "1" },
  );
  assert.equal(run.status, 1);
  const outcome = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /not running inside a Krad terminal/);
  assert.deepEqual(JSON.parse(readFileSync(argsFile, "utf8")), ["spawn", "--json", "--agent", "claude", "/improve"]);
});

test("spawn-chat reports a krad that cannot be started", (t) => {
  const { dir, out } = setup(t);
  const run = runHelper(dir, { krad: join(dir, "no-such-krad"), agent: "claude", task: "x", out }, {});
  assert.equal(run.status, 1);
  const outcome = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /ENOENT|not found|no-such-krad/i);
});
