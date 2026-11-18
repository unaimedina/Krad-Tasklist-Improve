// src/cache.ts
import { readdirSync as readdirSync2, readFileSync as readFileSync2, statSync as statSync2 } from "node:fs";
import { join as join2, resolve } from "node:path";

// src/plans.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// src/types.ts
var TASK_STATUSES = ["TODO", "IN PROGRESS", "DONE", "BLOCKED", "REJECTED"];

// src/plans.ts
var PLAN_FILE_RE = /^(\d{3})-(.+)\.md$/;
var INDEX_NAME = "README.md";
function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function listPlanFiles(dir) {
  try {
    return readdirSync(dir).filter((name) => PLAN_FILE_RE.test(name)).sort();
  } catch {
    return [];
  }
}
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  let body = trimmed.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const cells = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "|") {
      current += "\\|";
      i++;
    } else if (ch === "|") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}
function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}
function cleanCell(cell) {
  return (cell ?? "").replace(/[*_`]/g, "").trim();
}
function nullIfEmpty(text) {
  return text === "" ? null : text;
}
function isNoneText(text) {
  const t = text.trim().toLowerCase();
  return t === "" || t === "\u2014" || t === "\u2013" || t === "-" || t === "none" || t === "n/a";
}
function parseDependsCell(cell) {
  if (isNoneText(cleanCell(cell))) return [];
  return unique([...cell.matchAll(/\d{3}/g)].map((m) => m[0]));
}
function unique(ids) {
  return [...new Set(ids)];
}
function findTable(lines) {
  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i] ?? "");
    if (!cells) continue;
    const names = cells.map((c) => cleanCell(c).toLowerCase());
    if (!names.includes("plan") || !names.includes("status")) continue;
    const columns = /* @__PURE__ */ new Map();
    names.forEach((name, index) => {
      if (!columns.has(name)) columns.set(name, index);
    });
    let end = i + 1;
    while (end < lines.length && splitRow(lines[end] ?? "")) end++;
    return { header: i, end, columns };
  }
  return null;
}
function splitLines(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.split(/\r?\n/), eol };
}
function parseStatus(cell) {
  const text = cell.replace(/[*_`]/g, "").trim();
  const upper = text.toUpperCase();
  const byLength = [...TASK_STATUSES].sort((a, b) => b.length - a.length);
  const status = byLength.find((s) => upper.startsWith(s));
  if (!status) return { status: "TODO", note: nullIfEmpty(text) };
  let rest = text.slice(status.length).trim();
  rest = rest.replace(/^[(—–\-:]+/, "").trim();
  rest = rest.replace(/\)$/, "").trim();
  return { status, note: nullIfEmpty(rest) };
}
function parseIndex(text) {
  const { lines } = splitLines(text);
  const table = findTable(lines);
  if (!table) return [];
  const col = (name) => table.columns.get(name);
  const rows = [];
  for (let i = table.header + 1; i < table.end; i++) {
    const cells = splitRow(lines[i] ?? "");
    if (!cells || isSeparatorRow(cells)) continue;
    const get = (name) => {
      const index = col(name);
      return index === void 0 ? void 0 : cells[index];
    };
    const id = (get("plan") ?? "").match(/\d{3}/)?.[0];
    if (!id) continue;
    const { status, note } = parseStatus(get("status") ?? "");
    const title = cleanCell(get("title"));
    rows.push({
      id,
      title,
      priority: nullIfEmpty(cleanCell(get("priority"))),
      effort: nullIfEmpty(cleanCell(get("effort"))),
      dependsOn: parseDependsCell(get("depends on") ?? ""),
      status,
      statusNote: note,
      line: i
    });
  }
  return rows;
}
function bulletValue(lines, name) {
  const re = new RegExp(`^\\s*[-*]\\s+\\*\\*${name}\\*\\*\\s*:\\s*(.*)$`, "i");
  for (const line of lines) {
    const m = line.match(re);
    if (m) return (m[1] ?? "").trim();
  }
  return null;
}
function parseDependsBullet(value) {
  const cleaned = value.replace(/[*_`]/g, "").trim();
  if (isNoneText(cleaned)) return [];
  if (/\.md\b/i.test(cleaned)) {
    const re = /(?:^|[\/\s(,])(\d{3})-[a-z0-9-]+\.md/gi;
    return unique([...cleaned.matchAll(re)].map((m) => m[1] ?? "").filter((id) => id !== ""));
  }
  return unique(
    cleaned.split(/[,+]/).map((part) => part.trim()).filter((part) => /^\d{3}$/.test(part))
  );
}
function parsePlanFile(file, text) {
  const name = basename(file);
  const m = name.match(PLAN_FILE_RE);
  const id = m?.[1] ?? "";
  const slug = m?.[2] ?? name.replace(/\.md$/i, "");
  const { lines } = splitLines(text);
  let title = "";
  for (const line of lines) {
    const t = line.match(/^#\s+Plan\s+\d{3}\s*:\s*(.+)$/);
    if (t) {
      title = (t[1] ?? "").trim();
      break;
    }
  }
  const value = (key2) => {
    const v = bulletValue(lines, key2);
    return v === null ? null : nullIfEmpty(cleanCell(v));
  };
  const depends = bulletValue(lines, "Depends on");
  return {
    id,
    slug,
    file,
    title,
    priority: value("Priority"),
    effort: value("Effort"),
    risk: value("Risk"),
    dependsOn: depends === null ? [] : parseDependsBullet(depends)
  };
}
var MINIMAL_INDEX = [
  "# Implementation Plans",
  "",
  "## Execution order & status",
  "",
  "| Plan | Title | Priority | Effort | Depends on | Status |",
  "|------|-------|----------|--------|------------|--------|",
  "",
  "Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)",
  ""
].join("\n");
function findPlansDir(root) {
  for (const name of ["plans", "advisor-plans"]) {
    const dir = join(root, name);
    if (!isDir(dir)) continue;
    if (existsSync(join(dir, INDEX_NAME)) || listPlanFiles(dir).length > 0) return dir;
  }
  return null;
}
function loadPlanSet(root) {
  const set = { root, dir: null, indexFile: null, tasks: [], problems: [] };
  const dir = findPlansDir(root);
  if (!dir) return set;
  set.dir = dir;
  const indexPath = join(dir, INDEX_NAME);
  const indexText = existsSync(indexPath) ? readText(indexPath) : null;
  let rows = [];
  if (indexText === null) {
    set.problems.push(`${INDEX_NAME} is missing in ${basename(dir)}/`);
  } else {
    set.indexFile = indexPath;
    rows = parseIndex(indexText);
    if (rows.length === 0) set.problems.push(`${INDEX_NAME} has no status table with Plan and Status columns`);
  }
  const byId = /* @__PURE__ */ new Map();
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
  const files = listPlanFiles(dir);
  const seen = /* @__PURE__ */ new Set();
  for (const name of files) {
    const path = join(dir, name);
    const text = readText(path) ?? "";
    const parsed = parsePlanFile(path, text);
    if (seen.has(parsed.id)) {
      set.problems.push(`${name} reuses id ${parsed.id}`);
      continue;
    }
    seen.add(parsed.id);
    const row = byId.get(parsed.id);
    if (!row && indexText !== null) set.problems.push(`${name} has no row in ${INDEX_NAME}`);
    set.tasks.push({
      ...parsed,
      title: parsed.title || row?.title || parsed.slug,
      priority: parsed.priority ?? row?.priority ?? null,
      effort: parsed.effort ?? row?.effort ?? null,
      dependsOn: parsed.dependsOn.length > 0 ? parsed.dependsOn : row?.dependsOn ?? [],
      status: row?.status ?? "TODO",
      statusNote: row?.statusNote ?? null
    });
  }
  for (const row of rows) {
    if (!seen.has(row.id)) set.problems.push(`row ${row.id} in ${INDEX_NAME} has no plan file`);
  }
  set.tasks.sort((a, b) => a.id.localeCompare(b.id));
  return set;
}

// src/cache.ts
function folderStamp(dir) {
  let names;
  try {
    names = readdirSync2(dir).sort();
  } catch {
    return "missing";
  }
  return names.map((name) => {
    try {
      const stat = statSync2(join2(dir, name));
      return `${name}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return `${name}:gone`;
    }
  }).join("|");
}
function fileStamp(path) {
  try {
    const stat = statSync2(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}
function key(path) {
  const full = resolve(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? full.toLowerCase() : full;
}
var PlanCache = class {
  constructor(load = loadPlanSet, read = (path) => readFileSync2(path, "utf8")) {
    this.load = load;
    this.read = read;
  }
  sets = /* @__PURE__ */ new Map();
  texts = /* @__PURE__ */ new Map();
  /** The plan set of a group root, from memory while its plans folder is unchanged. */
  planSet(root) {
    const dir = findPlansDir(root);
    const stamp = dir === null ? "none" : `${dir}
${folderStamp(dir)}`;
    const id = key(root);
    const hit = this.sets.get(id);
    if (hit && hit.stamp === stamp) return hit.set;
    const set = this.load(root);
    this.sets.set(id, { stamp, set });
    return set;
  }
  /** The text of a plan file, from memory while the file is unchanged; null when unreadable. */
  planText(path) {
    const stamp = fileStamp(path);
    const id = key(path);
    const hit = this.texts.get(id);
    if (hit && hit.stamp === stamp) return hit.text;
    let text;
    try {
      text = this.read(path);
    } catch {
      text = null;
    }
    this.texts.set(id, { stamp, text });
    return text;
  }
  /** Forgets a root's plan set and the texts of the files under it; everything without a root. */
  invalidate(root) {
    if (root === void 0) {
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
};
export {
  PlanCache,
  fileStamp,
  folderStamp
};
