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
  /** Notifications from the program (e.g. view/patch), and waiters for them. */
  const notifications = [];
  const waiters = [];
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
      } else if (message.method) {
        notifications.push(message);
        for (const waiter of waiters.splice(0)) {
          if (waiter.match(message)) waiter.resolve(message);
          else waiters.push(waiter);
        }
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

  const notify = (method, params) => send({ method, params });

  /** The first notification (already seen or future) that matches. */
  const waitFor = (match, ms = 5000) =>
    new Promise((resolve, reject) => {
      const seen = notifications.find(match);
      if (seen) return resolve(seen);
      const timer = setTimeout(() => reject(new Error("no matching notification")), ms);
      waiters.push({ match, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });

  return { child, request, notify, waitFor };
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
  assert.equal(reply.result?.style?.height, "fill");
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

const FIXTURE_IDS = ["001", "002", "003", "004", "005", "007"];

test("the tasklist view serves the fixture tasks as list rows", async (t) => {
  const dir = fixtureRoot();
  const { child, request } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  const reply = await request("view/render", { view: "tasklist", instance: dir });
  const list = findNode(reply.result, "tasks");
  assert.equal(list?.type, "list", JSON.stringify(reply).slice(0, 500));
  assert.equal(list.selection, "single");
  assert.equal(list.count, FIXTURE_IDS.length);
  const rows = await request("view/rows", { view: "tasklist", instance: dir, node: "tasks", start: 0, end: list.count });
  assert.equal(rows.result?.kind, "list", JSON.stringify(rows));
  assert.deepEqual(rows.result.rows.map((r) => r.node.key), FIXTURE_IDS);
  assert.ok(rows.result.rows.every((r) => r.menu === undefined), "no row menus");
});

test("choosing a task patches the detail pane with its plan Markdown", async (t) => {
  const dir = fixtureRoot();
  const { child, request, notify, waitFor } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  await request("view/render", { view: "tasklist", instance: dir });
  notify("view/event", { view: "tasklist", instance: dir, event: { kind: "choose", node: "tasks", items: ["002"] } });
  const message = await waitFor((m) => m.method === "view/patch" && m.params?.view === "tasklist");
  const patches = message.params.patches;
  assert.equal(patches.length, 2, JSON.stringify(patches).slice(0, 500));
  assert.equal(patches[0].op, "replace");
  assert.equal(patches[0].node.key, "detail");
  assert.deepEqual(patches[1], { op: "invalidate", key: "tasks" });
  const md = findNode(patches[0].node, "plan-md");
  assert.equal(md?.type, "markdown");
  const plan = readFileSync(join(dir, "plans", "002-b.md"), "utf8");
  assert.ok(!md.text.includes("# Plan 002"), md.text.slice(0, 80));
  assert.ok(!/^## Status/m.test(md.text), md.text.slice(0, 80));
  assert.ok(md.text.startsWith("## Steps"), md.text.slice(0, 80));
  assert.ok(plan.endsWith(md.text), "the Markdown is the plan text minus its H1 and Status section");
  assert.equal(findNode(patches[0].node, "detail-title")?.text, "Plan B from file");

  // A later full render keeps the selection.
  const again = await request("view/render", { view: "tasklist", instance: dir });
  assert.equal(findNode(again.result, "plan-md")?.text, md.text);
});

test("the filter select re-counts the task list", async (t) => {
  const dir = fixtureRoot();
  const { child, request, notify, waitFor } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  await request("view/render", { view: "tasklist", instance: dir });
  notify("view/event", { view: "tasklist", instance: dir, event: { kind: "select", action: "filter", value: "done" } });
  const message = await waitFor((m) => m.method === "view/patch");
  assert.deepEqual(message.params.patches, [
    { op: "set_count", key: "tasks", count: 1 },
    { op: "invalidate", key: "tasks" },
  ]);
  const rows = await request("view/rows", { view: "tasklist", instance: dir, node: "tasks", start: 0, end: 10 });
  assert.deepEqual(rows.result.rows.map((r) => r.node.key), ["001"]);
});

/** Keys of a node's direct children. */
const childKeys = (node) => (node?.children ?? []).map((c) => c.key);

test("the Tasks page renders the same UI as the tab, plus Open in a tab", async (t) => {
  const dir = fixtureRoot();
  const empty = mkdtempSync(join(tmpdir(), "tasklist-"));
  // The group with plans/ is preferred even when it is not the first one.
  const { child, request } = startProgram([
    { id: "e", name: "empty", root: empty },
    { id: "g", name: "g", root: dir },
  ]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  const page = (await request("view/render", { view: "tasks" })).result;
  const tab = (await request("view/render", { view: "tasklist", instance: dir })).result;
  const text = JSON.stringify(page).slice(0, 500);
  assert.equal(page?.key, "root", text);
  assert.equal(page.style.height, "fill");
  assert.deepEqual(childKeys(page), childKeys(tab));
  assert.deepEqual(childKeys(findNode(page, "body")), ["tasks-pane", "detail"]);
  const list = findNode(page, "tasks");
  assert.equal(list?.type, "list", text);
  assert.equal(list.selection, "single");
  assert.equal(list.count, FIXTURE_IDS.length);
  assert.deepEqual(findNode(page, "body"), findNode(tab, "body"));
  // Open in a tab in the page header only; a group select because there are two groups.
  assert.equal(findNode(page, "toolbar-open-tab")?.action, "open-tab");
  assert.equal(findNode(tab, "toolbar-open-tab"), null);
  const group = findNode(page, "header-group");
  assert.equal(group?.action, "group");
  assert.equal(group.value, dir);
  assert.equal(findNode(tab, "header-group"), null);
  const rows = await request("view/rows", { view: "tasks", node: "tasks", start: 0, end: list.count });
  assert.deepEqual(rows.result?.rows?.map((r) => r.node.key), FIXTURE_IDS, JSON.stringify(rows).slice(0, 300));
});

test("choosing a task in the page selects it in the page, not in the tab", async (t) => {
  const dir = fixtureRoot();
  const { child, request, notify, waitFor } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  await request("view/render", { view: "tasks" });
  await request("view/render", { view: "tasklist", instance: dir });
  notify("view/event", { view: "tasks", event: { kind: "choose", node: "tasks", items: ["002"] } });
  const message = await waitFor((m) => m.method === "view/patch");
  assert.equal(message.params.view, "tasks", JSON.stringify(message.params).slice(0, 300));
  const patches = message.params.patches;
  assert.equal(patches[0].op, "replace");
  assert.equal(patches[0].node.key, "detail");
  assert.deepEqual(patches[1], { op: "invalidate", key: "tasks" });
  assert.ok(findNode(patches[0].node, "plan-md")?.text.startsWith("## Steps"));
  // The page keeps its selection; the tab still has none; no tab was opened.
  const page = await request("view/render", { view: "tasks" });
  assert.equal(findNode(page.result, "detail-title")?.text, "Plan B from file");
  const tab = await request("view/render", { view: "tasklist", instance: dir });
  assert.equal(findNode(tab.result, "plan-md"), null);
  assert.equal(findNode(tab.result, "detail-text")?.text, "Select a task to read its plan");
});

test("the Tasks page without plans or without a group shows its empty states", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tasklist-"));
  const { child, request } = startProgram([{ id: "g", name: "g", root: dir }]);
  const none = startProgram([]);
  t.after(() => {
    child.kill();
    none.child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  const reply = await request("view/render", { view: "tasks" });
  assert.equal(findNode(reply.result, "toolbar-open-tab")?.action, "open-tab", JSON.stringify(reply));
  assert.equal(findNode(reply.result, "tasks"), null);
  assert.equal(findNode(reply.result, "empty-generate")?.variant, "secondary");

  await none.request("initialize", INIT);
  const empty = await none.request("view/render", { view: "tasks" });
  assert.equal(findNode(empty.result, "empty-text")?.text, "Open a group to see its tasks.", JSON.stringify(empty));
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
