import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTask,
  findPlansDir,
  loadPlanSet,
  parseIndex,
  parsePlanFile,
  parseStatus,
  runnableTasks,
  setStatusInIndex,
} from "../dist/plans.js";

const fixtureDir = fileURLToPath(new URL("./fixtures/plans/", import.meta.url));

/** The fixture index, forced to CRLF (git may have normalized line endings on checkout). */
function fixtureIndex() {
  const text = readFileSync(new URL("./fixtures/plans/README.md", import.meta.url), "utf8");
  return text.replace(/\r?\n/g, "\r\n");
}

/** Copies the fixture into <temp>/plans and returns the temp root. */
function tempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "tasklist-plans-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(fixtureDir, join(root, "plans"), { recursive: true });
  writeFileSync(join(root, "plans", "README.md"), fixtureIndex());
  return root;
}

test("parseStatus reads status words and notes", () => {
  assert.deepEqual(parseStatus("DONE"), { status: "DONE", note: null });
  assert.deepEqual(parseStatus("**in progress**"), { status: "IN PROGRESS", note: null });
  assert.deepEqual(parseStatus("BLOCKED (x)"), { status: "BLOCKED", note: "x" });
  assert.deepEqual(parseStatus("BLOCKED — x"), { status: "BLOCKED", note: "x" });
  assert.deepEqual(parseStatus("REJECTED: y"), { status: "REJECTED", note: "y" });
  assert.deepEqual(parseStatus("weird"), { status: "TODO", note: "weird" });
});

test("parseIndex reads the fixture table", () => {
  const rows = parseIndex(fixtureIndex());
  assert.deepEqual(
    rows.map((r) => r.id),
    ["001", "002", "003", "004", "005", "006"],
  );
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(by["001"].dependsOn, []);
  assert.deepEqual(by["004"].dependsOn, ["001", "003"]);
  assert.deepEqual(by["005"].dependsOn, []);
  assert.deepEqual(by["006"].dependsOn, []);
  assert.equal(by["001"].status, "DONE");
  assert.equal(by["002"].status, "IN PROGRESS");
  assert.equal(by["003"].status, "BLOCKED");
  assert.equal(by["003"].statusNote, "needs an API key");
  assert.equal(by["004"].status, "TODO");
  assert.equal(by["004"].statusNote, null);
  assert.equal(by["004"].title, "Fourth plan");
  assert.equal(by["004"].effort, "L");
});

test("parsePlanFile never reads a date as a dependency", () => {
  const text = readFileSync(new URL("./fixtures/plans/002-b.md", import.meta.url), "utf8");
  const plan = parsePlanFile("/x/plans/002-b.md", text);
  assert.equal(plan.id, "002");
  assert.equal(plan.slug, "b");
  assert.equal(plan.title, "Plan B from file");
  assert.equal(plan.priority, "P1");
  assert.equal(plan.risk, "LOW");
  assert.deepEqual(plan.dependsOn, ["001"]);
});

test("loadPlanSet merges files with index rows", (t) => {
  const root = tempRoot(t);
  const set = loadPlanSet(root);
  assert.equal(set.dir, join(root, "plans"));
  assert.equal(set.indexFile, join(root, "plans", "README.md"));
  assert.deepEqual(
    set.tasks.map((task) => task.id),
    ["001", "002", "003", "004", "005", "007"],
  );
  const by = Object.fromEntries(set.tasks.map((task) => [task.id, task]));
  assert.equal(by["007"].status, "TODO");
  assert.equal(by["002"].status, "IN PROGRESS");
  assert.deepEqual(by["002"].dependsOn, ["001"]);
  assert.deepEqual(by["004"].dependsOn, ["001", "003"]);
  assert.equal(by["003"].statusNote, "needs an API key");
  assert.equal(by["005"].title, "Plan five");
  assert.ok(set.problems.some((p) => p.includes("006")), set.problems.join("; "));
  assert.ok(set.problems.some((p) => p.includes("007")), set.problems.join("; "));
});

test("runnableTasks returns TODO tasks whose dependencies are DONE", (t) => {
  const set = loadPlanSet(tempRoot(t));
  assert.deepEqual(
    runnableTasks(set.tasks).map((task) => task.id),
    ["005", "007"],
  );
  // A dependency that names no known task is unmet.
  const ghost = { ...set.tasks[0], id: "010", status: "TODO", dependsOn: ["099"] };
  assert.deepEqual(runnableTasks([ghost]), []);
});

test("setStatusInIndex edits one cell and keeps every other byte", () => {
  const before = fixtureIndex();
  const after = setStatusInIndex(before, "004", "DONE", null);
  assert.ok(after.includes("\r\n"));
  assert.ok(!/[^\r]\n/.test(after), "only CRLF line endings");
  const a = before.split("\r\n");
  const b = after.split("\r\n");
  assert.equal(a.length, b.length);
  const changed = a.map((line, i) => i).filter((i) => a[i] !== b[i]);
  assert.equal(changed.length, 1);
  const i = changed[0];
  assert.equal(a[i], "| 004  | Fourth plan | P2 | L | 001, 003 | TODO   |");
  assert.equal(b[i], "| 004  | Fourth plan | P2 | L | 001, 003 | DONE   |");

  const blocked = setStatusInIndex(before, "004", "BLOCKED", "no key");
  assert.ok(blocked.includes("| 004  | Fourth plan | P2 | L | 001, 003 | BLOCKED (no key) |\r\n"));
  assert.deepEqual(parseIndex(blocked).find((r) => r.id === "004")?.statusNote, "no key");

  const appended = setStatusInIndex(before, "009", "TODO", null, {
    title: "Ninth",
    priority: "P2",
    effort: "S",
    dependsOn: ["001"],
  });
  const rows = parseIndex(appended);
  assert.equal(rows.length, 7);
  const row9 = rows.at(-1);
  assert.equal(row9.id, "009");
  assert.equal(row9.title, "Ninth");
  assert.deepEqual(row9.dependsOn, ["001"]);
  assert.equal(row9.status, "TODO");
  assert.ok(!/[^\r]\n/.test(appended), "appended row keeps CRLF");
  // Rest of the file after the table is unchanged.
  assert.ok(appended.endsWith(before.slice(before.indexOf("\r\n\r\nStatus values"))));
});

test("createTask adds a plan file and a TODO row", (t) => {
  const root = tempRoot(t);
  const path = createTask(root, "Add dark mode!");
  assert.equal(path, join(root, "plans", "008-add-dark-mode.md"));
  const text = readFileSync(path, "utf8");
  assert.ok(text.startsWith("# Plan 008: Add dark mode!\n"));
  assert.ok(text.includes("- **Depends on**: none"));
  const set = loadPlanSet(root);
  const task = set.tasks.find((x) => x.id === "008");
  assert.equal(task?.status, "TODO");
  assert.equal(task?.title, "Add dark mode!");
  const row = parseIndex(readFileSync(join(root, "plans", "README.md"), "utf8")).find((r) => r.id === "008");
  assert.equal(row?.status, "TODO");

  // In an empty folder it creates plans/ and the index.
  const empty = mkdtempSync(join(tmpdir(), "tasklist-empty-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const first = createTask(empty, "First one");
  assert.equal(first, join(empty, "plans", "001-first-one.md"));
  assert.ok(existsSync(join(empty, "plans", "README.md")));
  assert.deepEqual(
    loadPlanSet(empty).tasks.map((x) => [x.id, x.status]),
    [["001", "TODO"]],
  );
});

test("findPlansDir prefers plans/, falls back to advisor-plans/, else null", (t) => {
  const root = mkdtempSync(join(tmpdir(), "tasklist-find-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(findPlansDir(root), null);
  mkdirSync(join(root, "plans")); // taken for something else: no index, no NNN files
  writeFileSync(join(root, "plans", "notes.txt"), "unrelated");
  mkdirSync(join(root, "advisor-plans"));
  writeFileSync(join(root, "advisor-plans", "README.md"), "# Implementation Plans\n");
  assert.equal(findPlansDir(root), join(root, "advisor-plans"));
});
