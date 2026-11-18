import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { PlanSet, Task, TaskStatus } from "./types.js";
import { TASK_STATUSES } from "./types.js";

const PLAN_FILE_RE = /^(\d{3})-(.+)\.md$/;
const INDEX_NAME = "README.md";

/** One row of the status table in plans/README.md. */
export interface IndexRow {
  id: string;
  title: string;
  priority: string | null;
  effort: string | null;
  dependsOn: string[];
  status: TaskStatus;
  statusNote: string | null;
  line: number; // 0-based line index in the index text
}

// ---------------------------------------------------------------------------
// Small helpers

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listPlanFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => PLAN_FILE_RE.test(name))
      .sort();
  } catch {
    return [];
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Splits a Markdown table row into its raw cells (without the outer pipes). Null when not a row. */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  let body = trimmed.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const cells: string[] = [];
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

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}

function cleanCell(cell: string | undefined): string {
  return (cell ?? "").replace(/[*_`]/g, "").trim();
}

function nullIfEmpty(text: string): string | null {
  return text === "" ? null : text;
}

function isNoneText(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === "" || t === "—" || t === "–" || t === "-" || t === "none" || t === "n/a";
}

function parseDependsCell(cell: string): string[] {
  if (isNoneText(cleanCell(cell))) return [];
  return unique([...cell.matchAll(/\d{3}/g)].map((m) => m[0]));
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

interface TableInfo {
  header: number; // line index of the header row
  end: number; // line index after the last row of the table
  columns: Map<string, number>; // lowercase header name → cell index
}

/** The first table whose header has Plan and Status columns. */
function findTable(lines: string[]): TableInfo | null {
  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i] ?? "");
    if (!cells) continue;
    const names = cells.map((c) => cleanCell(c).toLowerCase());
    if (!names.includes("plan") || !names.includes("status")) continue;
    const columns = new Map<string, number>();
    names.forEach((name, index) => {
      if (!columns.has(name)) columns.set(name, index);
    });
    let end = i + 1;
    while (end < lines.length && splitRow(lines[end] ?? "")) end++;
    return { header: i, end, columns };
  }
  return null;
}

function splitLines(text: string): { lines: string[]; eol: string } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.split(/\r?\n/), eol };
}

// ---------------------------------------------------------------------------
// Pure parsers

/** Reads a status cell: "**DONE**", "BLOCKED (reason)", "BLOCKED — reason", "in progress", ... */
export function parseStatus(cell: string): { status: TaskStatus; note: string | null } {
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

/** Rows of the status table of plans/README.md; [] when there is no such table. */
export function parseIndex(text: string): IndexRow[] {
  const { lines } = splitLines(text);
  const table = findTable(lines);
  if (!table) return [];
  const col = (name: string) => table.columns.get(name);
  const rows: IndexRow[] = [];
  for (let i = table.header + 1; i < table.end; i++) {
    const cells = splitRow(lines[i] ?? "");
    if (!cells || isSeparatorRow(cells)) continue;
    const get = (name: string): string | undefined => {
      const index = col(name);
      return index === undefined ? undefined : cells[index];
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
      line: i,
    });
  }
  return rows;
}

function bulletValue(lines: string[], name: string): string | null {
  const re = new RegExp(`^\\s*[-*]\\s+\\*\\*${name}\\*\\*\\s*:\\s*(.*)$`, "i");
  for (const line of lines) {
    const m = line.match(re);
    if (m) return (m[1] ?? "").trim();
  }
  return null;
}

function parseDependsBullet(value: string): string[] {
  const cleaned = value.replace(/[*_`]/g, "").trim();
  if (isNoneText(cleaned)) return [];
  if (/\.md\b/i.test(cleaned)) {
    const re = /(?:^|[\/\s(,])(\d{3})-[a-z0-9-]+\.md/gi;
    return unique([...cleaned.matchAll(re)].map((m) => m[1] ?? "").filter((id) => id !== ""));
  }
  // Bare ids separated by commas (or "+"), e.g. "001, 003".
  return unique(
    cleaned
      .split(/[,+]/)
      .map((part) => part.trim())
      .filter((part) => /^\d{3}$/.test(part)),
  );
}

/** Reads one plan file. `file` is its path; id and slug come from the file name. */
export function parsePlanFile(file: string, text: string): Omit<Task, "status" | "statusNote"> {
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
  const value = (key: string) => {
    const v = bulletValue(lines, key);
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
    dependsOn: depends === null ? [] : parseDependsBullet(depends),
  };
}

// ---------------------------------------------------------------------------
// Index editing

function formatStatus(status: TaskStatus, note: string | null): string {
  return note ? `${status} (${note})` : status;
}

/** Replaces the cell content keeping its surrounding spaces and padding width when the new text fits. */
function replaceCell(old: string, text: string): string {
  const lead = /^\s/.test(old) ? " " : "";
  const trail = /\s$/.test(old) ? " " : "";
  const minimal = `${lead}${text}${trail}`;
  return minimal.length < old.length ? minimal.padEnd(old.length, " ") : minimal;
}

/** Rebuilds a row line with one cell replaced, keeping all other bytes. */
function replaceRowCell(line: string, cellIndex: number, text: string): string {
  // Locate pipe positions (ignoring escaped pipes).
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      i++;
      continue;
    }
    if (line[i] === "|") pipes.push(i);
  }
  const start = pipes[cellIndex];
  if (start === undefined) return line;
  const end = pipes[cellIndex + 1] ?? line.length;
  const old = line.slice(start + 1, end);
  return line.slice(0, start + 1) + replaceCell(old, text) + line.slice(end);
}

/** Returns the index text with row `id`'s Status cell replaced; every other byte unchanged. */
export function setStatusInIndex(
  text: string,
  id: string,
  status: TaskStatus,
  note: string | null,
  fallback?: { title: string; priority: string | null; effort: string | null; dependsOn: string[] },
): string {
  const { lines, eol } = splitLines(text);
  const table = findTable(lines);
  const statusText = formatStatus(status, note);
  if (!table) {
    // No status table: append a fresh one at the end.
    const block = [
      "## Execution order & status",
      "",
      "| Plan | Title | Priority | Effort | Depends on | Status |",
      "|------|-------|----------|--------|------------|--------|",
      newRow(id, statusText, fallback),
      "",
    ].join(eol);
    if (text.trim() === "") return block;
    const base = /\r?\n$/.test(text) ? text : text + eol;
    return base + eol + block;
  }
  const statusCol = table.columns.get("status");
  if (statusCol === undefined) return text;
  const row = parseIndex(text).find((r) => r.id === id);
  if (row) {
    lines[row.line] = replaceRowCell(lines[row.line] ?? "", statusCol, statusText);
    return lines.join(eol);
  }
  // Append a row after the last table line, with the header's columns.
  const headerCells = splitRow(lines[table.header] ?? "") ?? [];
  const values = headerCells.map((cell) => {
    switch (cleanCell(cell).toLowerCase()) {
      case "plan":
        return id;
      case "title":
        return fallback?.title ?? "";
      case "priority":
        return fallback?.priority ?? "";
      case "effort":
        return fallback?.effort ?? "";
      case "depends on":
        return fallback && fallback.dependsOn.length > 0 ? fallback.dependsOn.join(", ") : "—";
      case "status":
        return statusText;
      default:
        return "";
    }
  });
  lines.splice(table.end, 0, `| ${values.join(" | ")} |`);
  return lines.join(eol);
}

function newRow(
  id: string,
  statusText: string,
  fallback?: { title: string; priority: string | null; effort: string | null; dependsOn: string[] },
): string {
  const deps = fallback && fallback.dependsOn.length > 0 ? fallback.dependsOn.join(", ") : "—";
  return `| ${id} | ${fallback?.title ?? ""} | ${fallback?.priority ?? ""} | ${fallback?.effort ?? ""} | ${deps} | ${statusText} |`;
}

const MINIMAL_INDEX = [
  "# Implementation Plans",
  "",
  "## Execution order & status",
  "",
  "| Plan | Title | Priority | Effort | Depends on | Status |",
  "|------|-------|----------|--------|------------|--------|",
  "",
  "Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// Folder I/O

/** plans/ if it has README.md or NNN-*.md files, else advisor-plans/ likewise, else null. */
export function findPlansDir(root: string): string | null {
  for (const name of ["plans", "advisor-plans"]) {
    const dir = join(root, name);
    if (!isDir(dir)) continue;
    if (existsSync(join(dir, INDEX_NAME)) || listPlanFiles(dir).length > 0) return dir;
  }
  return null;
}

/** Reads the folder: every NNN-*.md file merged with its index row. Never throws for content problems. */
export function loadPlanSet(root: string): PlanSet {
  const set: PlanSet = { root, dir: null, indexFile: null, tasks: [], problems: [] };
  const dir = findPlansDir(root);
  if (!dir) return set;
  set.dir = dir;
  const indexPath = join(dir, INDEX_NAME);
  const indexText = existsSync(indexPath) ? readText(indexPath) : null;
  let rows: IndexRow[] = [];
  if (indexText === null) {
    set.problems.push(`${INDEX_NAME} is missing in ${basename(dir)}/`);
  } else {
    set.indexFile = indexPath;
    rows = parseIndex(indexText);
    if (rows.length === 0) set.problems.push(`${INDEX_NAME} has no status table with Plan and Status columns`);
  }
  const byId = new Map<string, IndexRow>();
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);

  const files = listPlanFiles(dir);
  const seen = new Set<string>();
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
      dependsOn: parsed.dependsOn.length > 0 ? parsed.dependsOn : (row?.dependsOn ?? []),
      status: row?.status ?? "TODO",
      statusNote: row?.statusNote ?? null,
    });
  }
  for (const row of rows) {
    if (!seen.has(row.id)) set.problems.push(`row ${row.id} in ${INDEX_NAME} has no plan file`);
  }
  set.tasks.sort((a, b) => a.id.localeCompare(b.id));
  return set;
}

/** Reads, edits and writes plans/README.md (creates a minimal index if absent). */
export function writeStatus(set: PlanSet, id: string, status: TaskStatus, note: string | null): void {
  const dir = set.dir ?? join(set.root, "plans");
  mkdirSync(dir, { recursive: true });
  const indexPath = set.indexFile ?? join(dir, INDEX_NAME);
  const text = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : MINIMAL_INDEX;
  const task = set.tasks.find((t) => t.id === id);
  const fallback = task
    ? { title: task.title, priority: task.priority, effort: task.effort, dependsOn: task.dependsOn }
    : undefined;
  const next = setStatusInIndex(text, id, status, note, fallback);
  if (next !== text || !existsSync(indexPath)) writeFileSync(indexPath, next, "utf8");
}

/** Tasks whose status is TODO and every dependency is DONE, ordered by id. */
export function runnableTasks(tasks: Task[]): Task[] {
  const status = new Map(tasks.map((t) => [t.id, t.status] as const));
  return tasks
    .filter((t) => t.status === "TODO" && t.dependsOn.every((dep) => status.get(dep) === "DONE"))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "task";
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Creates plans/NNN-<slug>.md from a short title, adds a TODO row to the index; returns the path. */
export function createTask(root: string, title: string): string {
  const dir = findPlansDir(root) ?? join(root, "plans");
  mkdirSync(dir, { recursive: true });
  const indexPath = join(dir, INDEX_NAME);
  const indexText = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : MINIMAL_INDEX;
  const used = new Set<number>();
  for (const name of listPlanFiles(dir)) used.add(Number(name.slice(0, 3)));
  for (const row of parseIndex(indexText)) used.add(Number(row.id));
  const next = used.size === 0 ? 1 : Math.max(...used) + 1;
  const id = String(next).padStart(3, "0");
  const cleanTitle = title.trim() || "New task";
  const path = join(dir, `${id}-${slugify(cleanTitle)}.md`);
  const body = [
    `# Plan ${id}: ${cleanTitle}`,
    "",
    "## Status",
    "",
    "- **Priority**: P2",
    "- **Effort**: M",
    "- **Risk**: LOW",
    "- **Depends on**: none",
    "- **Category**: direction",
    `- **Planned at**: ${today()}, written by hand in Tasklist`,
    "",
    "## Why this matters",
    "",
    "## Steps",
    "",
    "### Step 1:",
    "",
    "**Verify**:",
    "",
    "## Done criteria",
    "",
    "- [ ]",
    "",
  ].join("\n");
  writeFileSync(path, body, { encoding: "utf8", flag: "wx" });
  const updated = setStatusInIndex(indexText, id, "TODO", null, {
    title: cleanTitle,
    priority: "P2",
    effort: "M",
    dependsOn: [],
  });
  writeFileSync(indexPath, updated, "utf8");
  return path;
}
