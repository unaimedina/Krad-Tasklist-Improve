// Run inside one of Krad's terminals as `node dist/spawn-chat.js <request.json>`: asks Krad, through
// `krad spawn`, for a native chat worker in that terminal's group, then writes the outcome to the
// request's `out` file for the extension to read. A Krad terminal (KRAD_ADE_TERMINAL set by the
// app) may spawn workers without a lead; the extension program itself is not one, hence this hop.
import { execFile } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

/** The request file the extension writes. kradArgs come before `spawn` (e.g. a script for node). */
export interface SpawnRequest {
  krad: string;
  kradArgs?: string[];
  agent: string;
  worktree?: string | null;
  task: string;
  out: string;
}

export type SpawnOutcome = { ok: true; terminal: number } | { ok: false; error: string };

/** Arguments after the krad program: [...kradArgs, spawn, --json, --agent, A, (--worktree, W), task]. */
export function spawnArgs(request: SpawnRequest): string[] {
  return [
    ...(request.kradArgs ?? []),
    "spawn",
    "--json",
    "--agent",
    request.agent,
    ...(request.worktree ? ["--worktree", request.worktree] : []),
    request.task,
  ];
}

/** The terminal id in a `{"Spawned":{"terminal":N}}` line of krad's output; null when absent. */
export function spawnedTerminal(stdout: string): number | null {
  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(text) as { Spawned?: { terminal?: unknown } };
      if (typeof parsed.Spawned?.terminal === "number") return parsed.Spawned.terminal;
    } catch {
      // not JSON
    }
  }
  return null;
}

/** Runs krad spawn without a shell (multi-line prompts and quotes pass as they are). */
export function runSpawn(request: SpawnRequest): Promise<SpawnOutcome> {
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
      },
    );
  });
}

/** Writes the outcome atomically (temp file + rename) so a poller never reads half of it. */
export function writeOutcome(out: string, outcome: SpawnOutcome): void {
  const temp = `${out}.tmp`;
  writeFileSync(temp, JSON.stringify(outcome));
  renameSync(temp, out);
}

function parseRequest(text: string): SpawnRequest {
  const raw = JSON.parse(text) as Record<string, unknown>;
  for (const key of ["krad", "agent", "task", "out"]) {
    if (typeof raw[key] !== "string" || !raw[key]) throw new Error(`request has no ${key}`);
  }
  const kradArgs = Array.isArray(raw.kradArgs) ? raw.kradArgs.filter((a): a is string => typeof a === "string") : [];
  return {
    krad: raw.krad as string,
    kradArgs,
    agent: raw.agent as string,
    worktree: typeof raw.worktree === "string" && raw.worktree ? raw.worktree : null,
    task: raw.task as string,
    out: raw.out as string,
  };
}

async function main(argv: string[]): Promise<number> {
  const file = argv[0];
  if (!file) {
    console.error("usage: node spawn-chat.js <request.json>");
    return 1;
  }
  let request: SpawnRequest;
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

// Bundled as dist/spawn-chat.js; importing it (tests) does not run it.
if (basename(process.argv[1] ?? "") === "spawn-chat.js") {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
