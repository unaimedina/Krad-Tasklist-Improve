import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PlanCache, fileStamp, folderStamp } from "../dist/cache.js";
import { loadPlanSet } from "../dist/plans.js";

const here = dirname(fileURLToPath(import.meta.url));

function fixtureRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), "tasklist-cache-"));
  cpSync(join(here, "fixtures", "plans"), join(dir, "plans"), { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A PlanCache that counts its reads. */
function countingCache() {
  const counts = { loads: 0, reads: 0 };
  const cache = new PlanCache(
    (root) => {
      counts.loads += 1;
      return loadPlanSet(root);
    },
    (path) => {
      counts.reads += 1;
      return readFileSync(path, "utf8");
    },
  );
  return { cache, counts };
}

test("the plan set comes from memory while the plans folder is unchanged", (t) => {
  const root = fixtureRoot(t);
  const { cache, counts } = countingCache();
  const first = cache.planSet(root);
  const second = cache.planSet(root);
  assert.equal(second, first, "the same object");
  assert.equal(counts.loads, 1);
});

test("a write to a plan or the index reloads the plan set", (t) => {
  const root = fixtureRoot(t);
  const { cache, counts } = countingCache();
  const first = cache.planSet(root);
  writeFileSync(join(root, "plans", "005-five.md"), "# Plan 005: Renamed five\n\n## Steps\n\n1. x\n");
  const second = cache.planSet(root);
  assert.notEqual(second, first);
  assert.equal(second.tasks.find((task) => task.id === "005").title, "Renamed five");
  assert.equal(counts.loads, 2);
  // A same-size rewrite is caught by the modification time.
  const index = join(root, "plans", "README.md");
  const text = readFileSync(index, "utf8");
  writeFileSync(index, text.replace("| TODO |", "| DONE |"));
  utimesSync(index, new Date(), new Date(Date.now() + 5000));
  const third = cache.planSet(root);
  assert.notEqual(third, second);
  assert.equal(counts.loads, 3);
  // A new plan file.
  writeFileSync(join(root, "plans", "008-eight.md"), "# Plan 008: Eight\n");
  assert.ok(cache.planSet(root).tasks.some((task) => task.id === "008"));
});

test("plan texts come from memory until the file changes; invalidate forgets a root", (t) => {
  const root = fixtureRoot(t);
  const { cache, counts } = countingCache();
  const file = join(root, "plans", "002-b.md");
  const text = cache.planText(file);
  assert.equal(cache.planText(file), text);
  assert.equal(counts.reads, 1);
  writeFileSync(file, "# Plan 002: Changed\n");
  assert.equal(cache.planText(file), "# Plan 002: Changed\n");
  assert.equal(counts.reads, 2);
  assert.equal(cache.planText(join(root, "plans", "missing.md")), null);

  cache.planSet(root);
  cache.invalidate(root);
  cache.planSet(root);
  cache.planText(file);
  assert.equal(counts.loads, 2);
  assert.equal(counts.reads, 4);
});

test("stamps change with sizes, times and entries", (t) => {
  const root = fixtureRoot(t);
  const dir = join(root, "plans");
  const stamp = folderStamp(dir);
  assert.equal(folderStamp(dir), stamp);
  writeFileSync(join(dir, "009-nine.md"), "# Plan 009: Nine\n");
  assert.notEqual(folderStamp(dir), stamp);
  assert.equal(folderStamp(join(root, "nope")), "missing");
  assert.equal(fileStamp(join(root, "nope.md")), "missing");
});
