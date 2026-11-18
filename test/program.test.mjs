import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFrame, FrameDecoder } from "@krad-ade/extension";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const INIT = {
  app: { name: "Krad ADE", version: "0.4.0" },
  api: "1.1",
  placement: "app",
  extension_folder: root,
  features: ["views", "commands", "tools"],
};

/** Spawn dist/main.js and talk framed JSON-RPC to it. */
function startProgram() {
  const child = spawn(process.execPath, ["dist/main.js"], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });
  const decoder = new FrameDecoder();
  const pending = new Map();
  const send = (message) => child.stdin.write(encodeFrame({ jsonrpc: "2.0", ...message }));

  child.stdout.on("data", (chunk) => {
    for (const message of decoder.push(chunk)) {
      if (message.method && message.id !== undefined) {
        // A request from the program to the app.
        if (message.method === "settings/get") send({ id: message.id, result: {} });
        else if (message.method === "workspace/context") send({ id: message.id, result: { groups: [] } });
        else send({ id: message.id, result: {} });
      } else if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });

  let nextId = 1;
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      send({ id, method, params });
    });

  return { child, request };
}

test("initialize replies with features", async (t) => {
  const { child, request } = startProgram();
  t.after(() => child.kill());
  const reply = await request("initialize", INIT);
  assert.ok(Array.isArray(reply.result?.features), JSON.stringify(reply));
});

test("view/render of the tasklist view returns the root column", async (t) => {
  const { child, request } = startProgram();
  const dir = mkdtempSync(join(tmpdir(), "tasklist-"));
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  const reply = await request("view/render", { view: "tasklist", instance: dir });
  assert.equal(reply.result?.type, "flex", JSON.stringify(reply));
  assert.equal(reply.result?.key, "root");
});
