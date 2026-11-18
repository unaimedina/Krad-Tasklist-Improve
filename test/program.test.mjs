import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
function startProgram(groups = [], answers = {}) {
  const child = spawn(process.execPath, ["dist/main.js"], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });
  const decoder = new FrameDecoder();
  const pending = new Map();
  /** Notifications from the program (e.g. view/patch), and waiters for them. */
  const notifications = [];
  const waiters = [];
  /** Requests from the program to the app, in order. */
  const appRequests = [];
  const send = (message) => child.stdin.write(encodeFrame({ jsonrpc: "2.0", ...message }));

  child.stdout.on("data", (chunk) => {
    for (const message of decoder.push(chunk)) {
      if (message.method && message.id !== undefined) {
        // A request from the program to the app.
        appRequests.push(message);
        if (message.method in answers) send({ id: message.id, result: answers[message.method] });
        else if (message.method === "settings/get") send({ id: message.id, result: {} });
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

  return { child, request, notify, waitFor, appRequests };
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
  // The plan renders one section at a time; 002 has one (Steps), shown without its heading line.
  assert.ok(!/^## /m.test(md.text), md.text.slice(0, 80));
  assert.ok(md.text.startsWith("### Step 1: Do it"), md.text.slice(0, 80));
  assert.ok(plan.includes(md.text), "the Markdown is a section of the plan");
  assert.equal(findNode(patches[0].node, "plan-sections"), null, "one section: no section select");
  assert.equal(findNode(patches[0].node, "detail-title")?.text, "Plan B from file");

  // A later full render keeps the selection.
  const again = await request("view/render", { view: "tasklist", instance: dir });
  assert.equal(findNode(again.result, "plan-md")?.text, md.text);
});

test("the filter select replaces the tasks pane with the new count; a reopened view starts on All", async (t) => {
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
  const [replace, invalidate] = message.params.patches;
  assert.equal(replace.op, "replace");
  assert.equal(replace.node.key, "tasks-pane");
  assert.equal(findNode(replace.node, "tasks")?.count, 1);
  assert.equal(findNode(replace.node, "tasks-count")?.text, "1 of 6");
  assert.equal(findNode(replace.node, "tasks-filter")?.value, "done");
  assert.deepEqual(invalidate, { op: "invalidate", key: "tasks" });
  const rows = await request("view/rows", { view: "tasklist", instance: dir, node: "tasks", start: 0, end: 10 });
  assert.deepEqual(rows.result.rows.map((r) => r.node.key), ["001"]);

  // The page has its own filter, on All.
  const page = await request("view/render", { view: "tasks" });
  assert.equal(findNode(page.result, "tasks-filter")?.value, "all");
  assert.equal(findNode(page.result, "tasks")?.count, 6);

  // Closing and reopening the tab starts it on All again.
  notify("view/closed", { view: "tasklist", instance: dir });
  const reopened = await request("view/render", { view: "tasklist", instance: dir });
  assert.equal(findNode(reopened.result, "tasks-filter")?.value, "all");
  assert.equal(findNode(reopened.result, "tasks")?.count, 6);
});

test("a status write patches the open views in place and leaves the plan scroll alone", async (t) => {
  const dir = fixtureRoot();
  const { child, request, notify, waitFor } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  await request("view/render", { view: "tasklist", instance: dir });
  notify("view/event", { view: "tasklist", instance: dir, event: { kind: "choose", node: "tasks", items: ["005"] } });
  await waitFor((m) => m.method === "view/patch");
  const before = (await request("tool/call", { tool: "tasklist_set_status", arguments: { id: "005", status: "DONE" }, root: dir })).result;
  assert.equal(before?.content?.[0]?.text, "Task 005 is now DONE.");
  const message = await waitFor(
    (m) => m.method === "view/patch" && m.params.patches.some((p) => p.node?.key === "detail-top"),
  );
  const keys = message.params.patches.map((p) => p.node?.key ?? `${p.op}:${p.key}`);
  // Header, the list's count and rows, the top of the plan pane; not the root, not the plan scroll.
  assert.ok(keys.includes("header"), keys.join(","));
  assert.ok(keys.includes("tasks-pane-header"), keys.join(","));
  assert.ok(keys.includes("invalidate:tasks"), keys.join(","));
  assert.ok(keys.includes("detail-top"), keys.join(","));
  assert.ok(!keys.includes("root"), keys.join(","));
  assert.ok(!keys.includes("detail-plan"), keys.join(","));
  const top = message.params.patches.find((p) => p.node?.key === "detail-top").node;
  assert.equal(findNode(top, "detail-status-badge")?.text, "done");
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
  // Open in a tab in the page header only; a group button because there are two groups.
  assert.equal(findNode(page, "toolbar-open-tab")?.action, "open-tab");
  assert.equal(findNode(tab, "toolbar-open-tab"), null);
  const group = findNode(page, "header-group");
  assert.equal(group?.action, "group");
  assert.equal(group.type, "button");
  assert.equal(group.label, "g");
  assert.equal(group.icon, "chevron-down");
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
  assert.ok(findNode(patches[0].node, "plan-md")?.text.startsWith("### Step 1: Do it"));
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

test("Edit with a prompt asks what to change and starts the agent on that plan file only", async (t) => {
  const dir = fixtureRoot();
  const instruction = "Split step 1 in two";
  const { child, request, notify, waitFor, appRequests } = startProgram([{ id: "g", name: "g", root: dir }], {
    "window/input": instruction,
    "terminal/open": 41,
  });
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  const ref = { view: "tasklist", instance: dir };
  const before = readFileSync(join(dir, "plans", "002-b.md"), "utf8");
  await request("initialize", INIT);
  await request("view/render", ref);
  notify("view/event", { ...ref, event: { kind: "choose", node: "tasks", items: ["002"] } });
  notify("view/event", { ...ref, event: { kind: "click", action: "quick-edit" } });
  await waitFor((m) => m.method === "window/toast" && /Editing plan 002/.test(m.params.message));
  const ask = appRequests.find((m) => m.method === "window/input");
  assert.equal(ask.params.title, "Edit plan 002 with claude");
  const open = appRequests.find((m) => m.method === "terminal/open");
  assert.equal(open.params.cwd, dir);
  assert.equal(open.params.title, "edit 002 · claude");
  const command = JSON.stringify(open.params.command);
  assert.match(command, /Edit the implementation plan in plans\/002-b\.md\. The change: Split step 1 in two/);
  assert.match(command, /Do not carry out the plan/);
  // The program itself does not touch the plan; the agent does.
  assert.equal(readFileSync(join(dir, "plans", "002-b.md"), "utf8"), before);
  // No in-tab editor any more.
  const view = await request("view/render", ref);
  assert.equal(findNode(view.result, "plan-input"), null);
  assert.ok(findNode(view.result, "plan-md"));
});

test("an agent's write to the plan refreshes the open views", async (t) => {
  const dir = fixtureRoot();
  const { child, request, notify, waitFor } = startProgram([{ id: "g", name: "g", root: dir }], {
    "window/input": "Rename step 1",
    "terminal/open": 42,
  });
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  const ref = { view: "tasklist", instance: dir };
  await request("initialize", INIT);
  await request("view/render", ref);
  notify("view/event", { ...ref, event: { kind: "choose", node: "tasks", items: ["002"] } });
  notify("view/event", { ...ref, event: { kind: "click", action: "quick-edit" } });
  await waitFor((m) => m.method === "window/toast" && /Editing plan 002/.test(m.params.message));
  // Stand in for the agent: write the plan outside Krad's editor.
  writeFileSync(join(dir, "plans", "002-b.md"), "# Plan 002: Plan B from file\n\n## Steps\n\n1. Renamed by the agent.\n");
  const message = await waitFor(
    (m) => m.method === "view/patch" && JSON.stringify(m.params.patches).includes("Renamed by the agent"),
  );
  const md = message.params.patches.map((p) => findNode(p.node, "plan-md")).find(Boolean);
  assert.equal(md.text, "1. Renamed by the agent.");
});

const isPatch = (m) => m.method === "view/patch";
const patchKeys = (m) => m.params.patches.map((p) => p.node?.key ?? `${p.op}:${p.key}`);

test("the page's group button opens the app's picker and switches group", async (t) => {
  const dir = fixtureRoot();
  const empty = mkdtempSync(join(tmpdir(), "tasklist-"));
  const { child, request, notify, waitFor, appRequests } = startProgram(
    [
      { id: "g", name: "g", root: dir },
      { id: "e", name: "empty", root: empty },
    ],
    { "window/pick": [empty] },
  );
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  });
  await request("initialize", INIT);
  const before = await request("view/render", { view: "tasks" });
  assert.equal(findNode(before.result, "header-group")?.label, "g");
  notify("view/event", { view: "tasks", event: { kind: "click", action: "group" } });
  const message = await waitFor((m) => isPatch(m) && patchKeys(m).includes("root"));
  const pick = appRequests.find((m) => m.method === "window/pick");
  assert.deepEqual(pick.params.items.map((i) => i.label), ["g", "empty"]);
  const root = message.params.patches.find((p) => p.node?.key === "root").node;
  assert.equal(findNode(root, "header-group")?.label, "empty");
  assert.ok(findNode(root, "empty"), "the empty group shows its no-plans state");
});

test("Change status opens the app's picker and writes the chosen status", async (t) => {
  const dir = fixtureRoot();
  const { child, request, notify, waitFor, appRequests } = startProgram([{ id: "g", name: "g", root: dir }], {
    "window/pick": ["DONE"],
  });
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  const ref = { view: "tasklist", instance: dir };
  await request("initialize", INIT);
  await request("view/render", ref);
  notify("view/event", { ...ref, event: { kind: "choose", node: "tasks", items: ["005"] } });
  notify("view/event", { ...ref, event: { kind: "click", action: "set-status" } });
  const message = await waitFor(
    (m) => isPatch(m) && patchKeys(m).includes("detail-top") && JSON.stringify(m.params.patches).includes('"text":"done"'),
  );
  const pick = appRequests.find((m) => m.method === "window/pick");
  assert.equal(pick.params.title, "Status of plan 005");
  assert.deepEqual(pick.params.items.map((i) => i.value), ["TODO", "IN PROGRESS", "DONE", "BLOCKED", "REJECTED"]);
  assert.equal(pick.params.items.find((i) => i.value === "TODO").detail, "current");
  const index = readFileSync(join(dir, "plans", "README.md"), "utf8");
  assert.match(index, /\| \[005\]\(005-five\.md\) \| Fifth plan \| P3 \| S \| — \| DONE \|/);
  const top = message.params.patches.find((p) => p.node?.key === "detail-top").node;
  assert.equal(findNode(top, "detail-status-badge")?.text, "done");
});

test("the layout button stacks the panes and remembers it for that view", async (t) => {
  const dir = fixtureRoot();
  const { child, request, notify, waitFor } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  const ref = { view: "tasklist", instance: dir };
  await request("initialize", INIT);
  const side = await request("view/render", ref);
  assert.equal(findNode(side.result, "body")?.direction, "row");
  notify("view/event", { ...ref, event: { kind: "click", action: "layout" } });
  const message = await waitFor((m) => isPatch(m) && patchKeys(m).includes("root"));
  const root = message.params.patches.find((p) => p.node?.key === "root").node;
  assert.equal(findNode(root, "body")?.direction, "column");
  // The next render keeps it; the page keeps its own (side by side).
  assert.equal(findNode((await request("view/render", ref)).result, "body")?.direction, "column");
  assert.equal(findNode((await request("view/render", { view: "tasks" })).result, "body")?.direction, "row");
});

test("switching section patches the section select (with the new value) and the plan scroll", async (t) => {
  const dir = fixtureRoot();
  writeFileSync(
    join(dir, "plans", "005-five.md"),
    "# Plan 005: Plan five\n\nIntro text.\n\n## Status\n\n- **Priority**: P1\n\n## Why this matters\n\nBecause.\n\n## Steps\n\n1. Do it.\n",
  );
  const { child, request, notify, waitFor } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  const ref = { view: "tasklist", instance: dir };
  await request("initialize", INIT);
  await request("view/render", ref);
  notify("view/event", { ...ref, event: { kind: "choose", node: "tasks", items: ["005"] } });
  const chosen = await waitFor((m) => isPatch(m) && patchKeys(m).includes("detail"));
  const detail = chosen.params.patches[0].node;
  const select = findNode(detail, "plan-sections");
  assert.deepEqual(select.options.map((o) => o.label), ["All", "Overview", "Why this matters", "Steps"]);
  // The default is Overview, not All.
  assert.equal(select.value, select.options[1].value);
  assert.equal(findNode(detail, "plan-md").text, "Intro text.");
  const steps = select.options.find((o) => o.label === "Steps").value;
  notify("view/event", { ...ref, event: { kind: "select", action: "section", value: steps } });
  const switched = await waitFor((m) => isPatch(m) && patchKeys(m).includes("plan-scroll"));
  // The select moves its highlight to the chosen section: the app does not do it by itself.
  assert.deepEqual(patchKeys(switched), ["plan-sections", "plan-scroll"]);
  assert.equal(switched.params.patches[0].node.value, steps);
  assert.equal(findNode(switched.params.patches[1].node, "plan-md").text, "1. Do it.");
  // The choice holds across renders.
  assert.equal(findNode((await request("view/render", ref)).result, "plan-md").text, "1. Do it.");

  // All: the select on All, the whole plan (without its H1 and Status section) as the scroll's one
  // Markdown node.
  notify("view/event", { ...ref, event: { kind: "select", action: "section", value: "all" } });
  const all = await waitFor((m) => isPatch(m) && JSON.stringify(m.params.patches).includes("Because."));
  assert.deepEqual(patchKeys(all), ["plan-sections", "plan-scroll"]);
  assert.equal(all.params.patches[0].node.value, "all");
  const parts = all.params.patches[1].node.children;
  assert.deepEqual(parts.map((n) => [n.key, n.type]), [["plan-md", "markdown"]]);
  assert.equal(parts[0].text, "Intro text.\n\n## Why this matters\n\nBecause.\n\n## Steps\n\n1. Do it.\n");
  assert.ok(!parts[0].text.includes("# Plan 005") && !parts[0].text.includes("Priority"));
  assert.equal(findNode((await request("view/render", ref)).result, "plan-sections").value, "all");

  // A change to the plan, with All shown: only the one Markdown node is re-sent, not the scroll or the pane.
  writeFileSync(
    join(dir, "plans", "005-five.md"),
    "# Plan 005: Plan five\n\nIntro text.\n\n## Status\n\n- **Priority**: P1\n\n## Why this matters\n\nBecause, really.\n\n## Steps\n\n1. Do it.\n",
  );
  notify("workspace/event", { kind: "file_saved", path: join(dir, "plans", "005-five.md") });
  const refreshed = await waitFor((m) => isPatch(m) && JSON.stringify(m.params.patches).includes("Because, really."));
  const planKeys = patchKeys(refreshed).filter((k) => k.startsWith("plan") || k === "detail-plan");
  assert.deepEqual(planKeys, ["plan-md"]);
  assert.ok(refreshed.params.patches.find((p) => p.node?.key === "plan-md").node.text.includes("Because, really."));
});

test("Open in Krad's viewer opens the plan file in the app", async (t) => {
  const dir = fixtureRoot();
  const { child, request, notify, waitFor, appRequests } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  const ref = { view: "tasklist", instance: dir };
  await request("initialize", INIT);
  await request("view/render", ref);
  notify("view/event", { ...ref, event: { kind: "choose", node: "tasks", items: ["003"] } });
  await waitFor((m) => isPatch(m) && patchKeys(m).includes("detail"));
  notify("view/event", { ...ref, event: { kind: "click", action: "open-viewer" } });
  await request("view/render", ref);
  const open = appRequests.find((m) => m.method === "file/open");
  assert.ok(open, appRequests.map((m) => m.method).join(","));
  assert.equal(open.params.path, join(dir, "plans", "003-c.md"));
});

test("rows() serves the list from memory: it works with the plans folder gone", async (t) => {
  const dir = fixtureRoot();
  const { child, request } = startProgram([{ id: "g", name: "g", root: dir }]);
  t.after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  const ref = { view: "tasklist", instance: dir };
  await request("initialize", INIT);
  await request("view/render", ref);
  rmSync(join(dir, "plans"), { recursive: true, force: true });
  const rows = await request("view/rows", { ...ref, node: "tasks", start: 1, end: 3 });
  assert.deepEqual(rows.result?.rows?.map((r) => r.node.key), ["002", "003"], JSON.stringify(rows).slice(0, 300));
});
