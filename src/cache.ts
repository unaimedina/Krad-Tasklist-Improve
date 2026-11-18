import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { findPlansDir, loadPlanSet } from "./plans.js";
import type { PlanSet } from "./types.js";

/**
 * A stamp of a folder's entries: their names, sizes and modification times. It changes when a
 * file is written, added, removed or renamed, and costs one readdir and one stat per entry, much
 * less than reading and parsing every plan.
 */
export function folderStamp(dir: string): string {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return "missing";
  }
  return names
    .map((name) => {
      try {
        const stat = statSync(join(dir, name));
        return `${name}:${stat.size}:${stat.mtimeMs}`;
      } catch {
        return `${name}:gone`;
      }
    })
    .join("|");
}

/** A stamp of one file: its size and modification time, or "missing". */
export function fileStamp(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}

function key(path: string): string {
  const full = resolve(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? full.toLowerCase() : full;
}

/**
 * Plan sets per group root and plan texts per file, read again only when their stamp changes or
 * after `invalidate`. Renders, rows and refreshes then cost a few stats instead of reading and
 * parsing every plan each time. Callers must not mutate what it returns.
 */
export class PlanCache {
  private readonly sets = new Map<string, { stamp: string; set: PlanSet }>();
  private readonly texts = new Map<string, { stamp: string; text: string | null }>();

  constructor(
    private readonly load: (root: string) => PlanSet = loadPlanSet,
    private readonly read: (path: string) => string = (path) => readFileSync(path, "utf8"),
  ) {}

  /** The plan set of a group root, from memory while its plans folder is unchanged. */
  planSet(root: string): PlanSet {
    const dir = findPlansDir(root);
    const stamp = dir === null ? "none" : `${dir}\n${folderStamp(dir)}`;
    const id = key(root);
    const hit = this.sets.get(id);
    if (hit && hit.stamp === stamp) return hit.set;
    const set = this.load(root);
    this.sets.set(id, { stamp, set });
    return set;
  }

  /** The text of a plan file, from memory while the file is unchanged; null when unreadable. */
  planText(path: string): string | null {
    const stamp = fileStamp(path);
    const id = key(path);
    const hit = this.texts.get(id);
    if (hit && hit.stamp === stamp) return hit.text;
    let text: string | null;
    try {
      text = this.read(path);
    } catch {
      text = null;
    }
    this.texts.set(id, { stamp, text });
    return text;
  }

  /** Forgets a root's plan set and the texts of the files under it; everything without a root. */
  invalidate(root?: string): void {
    if (root === undefined) {
      this.sets.clear();
      this.texts.clear();
      return;
    }
    const id = key(root);
    this.sets.delete(id);
    for (const path of [...this.texts.keys()]) {
      if (path === id || path.startsWith(`${id}\\`) || path.startsWith(`${id}/`)) this.texts.delete(path);
    }
  }
}
