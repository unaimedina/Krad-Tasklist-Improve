import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
function startProgram(groups = []) {
  const child = spawn(process.execPath, ["dist/main.js"], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });
  const decoder = new FrameDecoder();
  const pending = new Map();
  const send = (message) => child.stdin.write(encodeFrame({ jsonrpc: "2.0", ...message }));

  child.stdout.on("data", (chunk) => {
    for (const message of decoder.push(chunk)) {
      if (message.method && message.id !== undefined) {
        // A request from the program to the app.
        if (message.method === "settings/get") send({ id: message.id, result: {} });
        else if (message.method === "workspace/context") send({ id: message.id, result: { groups } });
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

/** A temp group root holding a copy of test/fixtures/plans as plans/. */
function fixtureRoot() {
  const dir = mkdtempSync(join(tmpdir(), "tasklist-"));
  cpSync(join(root, "test", "fixtures", "plans"), join(dir, "plans"), { recursive: true });
  return dir;
}

function findNode(node, key) {
  if (!node || typeof node !== "object") return null;
  if (node.key === key) return node;
  for (const value of Object.values(node)) {
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      const found = findNode(child, key);
      if (found) return found;
    }
  }
  return null;
}

test("the tasklist view lists the fixture tasks", async (t) => {
  const dir = fixtureRoot();
  const { child, request } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  const reply = await request("view/render", { view: "tasklist", instance: dir });
  const tree = findNode(reply.result, "tasks");
  assert.ok(tree, JSON.stringify(reply).slice(0, 500));
  const keys = JSON.stringify(tree);
  for (const id of ["001", "002", "003", "004", "005", "007"]) assert.match(keys, new RegExp(`"key":"${id}"`), id);
});

test("tasklist_list lists the tasks of the given root", async (t) => {
  const dir = fixtureRoot();
  const { child, request } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  const reply = await request("tool/call", { tool: "tasklist_list", arguments: {}, root: dir });
  const text = reply.result?.content?.[0]?.text ?? "";
  assert.equal(reply.result?.outcome, "done", JSON.stringify(reply));
  assert.match(text, /^plans: /);
  const row = text.split("\n").find((line) => line.startsWith("004\t"));
  assert.ok(row, text);
  assert.deepEqual(row.split("\t").filter((_, i) => i !== 2), ["004", "TODO", "after: 001, 003", "plans/004-d.md"]);
});

test("tasklist_set_status writes the README row and rejects unknown ids", async (t) => {
  const dir = fixtureRoot();
  const { child, request } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  // No root argument: the tool falls back to the first group.
  const reply = await request("tool/call", { tool: "tasklist_set_status", arguments: { id: "005", status: "DONE" } });
  assert.equal(reply.result?.content?.[0]?.text, "Task 005 is now DONE.", JSON.stringify(reply));
  const index = readFileSync(join(dir, "plans", "README.md"), "utf8");
  assert.match(index, /\| \[005\]\(005-five\.md\) \| Fifth plan \| P3 \| S \| — \| DONE \|/);

  const unknown = await request("tool/call", { tool: "tasklist_set_status", arguments: { id: "099", status: "DONE" }, root: dir });
  assert.equal(unknown.result?.outcome, "failed", JSON.stringify(unknown));
  const bad = await request("tool/call", { tool: "tasklist_set_status", arguments: { id: "001", status: "FINISHED" }, root: dir });
  assert.equal(bad.result?.outcome, "failed", JSON.stringify(bad));
});
