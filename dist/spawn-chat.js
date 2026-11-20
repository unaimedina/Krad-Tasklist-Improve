// src/spawn-chat.ts
import { execFile } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
function spawnArgs(request) {
  return [
    ...request.kradArgs ?? [],
    "spawn",
    "--json",
    "--agent",
    request.agent,
    ...request.worktree ? ["--worktree", request.worktree] : [],
    request.task
  ];
}
function spawnedTerminal(stdout) {
  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed.Spawned?.terminal === "number") return parsed.Spawned.terminal;
    } catch {
    }
  }
  return null;
}
function runSpawn(request) {
  return new Promise((resolve) => {
    execFile(
      request.krad,
      spawnArgs(request),
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const out = String(stdout);
        const terminal = spawnedTerminal(out);
        if (terminal !== null) return resolve({ ok: true, terminal });
        const detail = String(stderr).trim() || out.trim() || (error ? error.message : "");
        resolve({ ok: false, error: detail || "krad spawn printed no Spawned terminal" });
      }
    );
  });
}
function writeOutcome(out, outcome) {
  const temp = `${out}.tmp`;
  writeFileSync(temp, JSON.stringify(outcome));
  renameSync(temp, out);
}
function parseRequest(text) {
  const raw = JSON.parse(text);
  for (const key of ["krad", "agent", "task", "out"]) {
    if (typeof raw[key] !== "string" || !raw[key]) throw new Error(`request has no ${key}`);
  }
  const kradArgs = Array.isArray(raw.kradArgs) ? raw.kradArgs.filter((a) => typeof a === "string") : [];
  return {
    krad: raw.krad,
    kradArgs,
    agent: raw.agent,
    worktree: typeof raw.worktree === "string" && raw.worktree ? raw.worktree : null,
    task: raw.task,
    out: raw.out
  };
}
async function main(argv) {
  const file = argv[0];
  if (!file) {
    console.error("usage: node spawn-chat.js <request.json>");
    return 1;
  }
  let request;
  try {
    request = parseRequest(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Could not read the chat request: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const outcome = await runSpawn(request);
  try {
    writeOutcome(request.out, outcome);
  } catch (error) {
    console.error(`Could not write the chat result: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (outcome.ok) {
    console.log(`Started a ${request.agent} chat (terminal ${outcome.terminal}).`);
    return 0;
  }
  console.error(`Could not start a ${request.agent} chat: ${outcome.error}`);
  return 1;
}
if (basename(process.argv[1] ?? "") === "spawn-chat.js") {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
export {
  runSpawn,
  spawnArgs,
  spawnedTerminal,
  writeOutcome
};
