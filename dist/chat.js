// src/chat.ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
var CHAT_TIMEOUT_MS = 2e4;
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function readOutcome(file) {
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (raw.ok === true && typeof raw.terminal === "number") return { ok: true, terminal: raw.terminal };
    return { ok: false, error: typeof raw.error === "string" ? raw.error : JSON.stringify(raw) };
  } catch {
    return null;
  }
}
async function openChat(root, spec, deps) {
  const dir = mkdtempSync(join(tmpdir(), "tasklist-chat-"));
  try {
    const out = join(dir, "result.json");
    const request = {
      krad: deps.krad.program,
      kradArgs: deps.krad.prefixArgs,
      agent: spec.agent,
      worktree: spec.worktree ?? null,
      task: spec.task,
      out
    };
    const requestFile = join(dir, "request.json");
    writeFileSync(requestFile, JSON.stringify(request));
    await deps.app.openTerminal({
      title: "Starting chat\u2026",
      cwd: root,
      zone: "utilities",
      command: { program: process.execPath, args: [join(deps.extensionFolder, "dist", "spawn-chat.js"), requestFile] }
    });
    const deadline = Date.now() + (deps.timeoutMs ?? CHAT_TIMEOUT_MS);
    for (; ; ) {
      const outcome = readOutcome(out);
      if (outcome?.ok) return outcome.terminal;
      if (outcome) throw new Error(outcome.error);
      if (Date.now() >= deadline) throw new Error(`no answer from krad spawn within ${Math.round((deps.timeoutMs ?? CHAT_TIMEOUT_MS) / 1e3)} s`);
      await sleep(deps.pollMs ?? 200);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
export {
  CHAT_TIMEOUT_MS,
  openChat
};
