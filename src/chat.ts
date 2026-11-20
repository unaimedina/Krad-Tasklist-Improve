// Opening an agent as a native Krad chat: the extension opens a utilities terminal that runs
// dist/spawn-chat.js, which calls `krad spawn` from inside Krad (see spawn-chat.ts), and reads the
// new chat's bus terminal id back from a result file.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "@krad-ade/extension";
import type { KradCli } from "./runner.js";
import type { SpawnOutcome, SpawnRequest } from "./spawn-chat.js";
import type { Harness } from "./types.js";

export interface ChatSpec {
  agent: Harness;
  task: string;              // the full prompt, as the user would type it
  title: string;             // for messages
  worktree?: string | null;  // a new worktree Krad creates as <repo>.worktrees/<name>
}

export interface ChatDeps {
  app: App;
  extensionFolder: string;
  krad: KradCli;
  /** How long to wait for the helper's result (ms). */
  timeoutMs?: number;
  pollMs?: number;
}

export const CHAT_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readOutcome(file: string): SpawnOutcome | null {
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (raw.ok === true && typeof raw.terminal === "number") return { ok: true, terminal: raw.terminal };
    return { ok: false, error: typeof raw.error === "string" ? raw.error : JSON.stringify(raw) };
  } catch {
    return null; // not fully written yet
  }
}

/**
 * Starts a native chat in the group of the terminal opened at root. Resolves with the chat's bus
 * terminal id; rejects with the reason (krad's error text, or a timeout) when no chat started.
 */
export async function openChat(root: string, spec: ChatSpec, deps: ChatDeps): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "tasklist-chat-"));
  try {
    const out = join(dir, "result.json");
    const request: SpawnRequest = {
      krad: deps.krad.program,
      kradArgs: deps.krad.prefixArgs,
      agent: spec.agent,
      worktree: spec.worktree ?? null,
      task: spec.task,
      out,
    };
    const requestFile = join(dir, "request.json");
    writeFileSync(requestFile, JSON.stringify(request));
    await deps.app.openTerminal({
      title: "Starting chat…",
      cwd: root,
      zone: "utilities",
      command: { program: process.execPath, args: [join(deps.extensionFolder, "dist", "spawn-chat.js"), requestFile] },
    });
    const deadline = Date.now() + (deps.timeoutMs ?? CHAT_TIMEOUT_MS);
    for (;;) {
      const outcome = readOutcome(out);
      if (outcome?.ok) return outcome.terminal;
      if (outcome) throw new Error(outcome.error);
      if (Date.now() >= deadline) throw new Error(`no answer from krad spawn within ${Math.round((deps.timeoutMs ?? CHAT_TIMEOUT_MS) / 1000)} s`);
      await sleep(deps.pollMs ?? 200);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
