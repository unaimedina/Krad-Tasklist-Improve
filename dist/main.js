// src/main.ts
import { execFile as execFile2 } from "node:child_process";
import { watch } from "node:fs";
import { basename as basename3, dirname, relative as relative2, resolve as resolve3, sep } from "node:path";
import { promisify as promisify2 } from "node:util";

// node_modules/@krad-ade/extension/dist/view.js
function node(type, key2, fields) {
  return { key: key2, type, ...fields };
}
var ui = {
  flex: (key2, children, options2 = {}) => node("flex", key2, { ...options2, children }),
  row: (key2, children, style = {}) => node("flex", key2, { direction: "row", style, children }),
  column: (key2, children, style = {}) => node("flex", key2, { direction: "column", align: "stretch", style, children }),
  stack: (key2, children, style = {}) => node("stack", key2, { style, children }),
  grid: (key2, columns, children, style = {}) => node("grid", key2, { columns, style, children }),
  scroll: (key2, children, direction = "column") => node("scroll", key2, { direction, children }),
  text: (key2, text, style = {}) => node("text", key2, { text, style }),
  markdown: (key2, text) => node("markdown", key2, { text }),
  icon: (key2, icon, color) => node("icon", key2, { icon, color: color ?? null }),
  image: (key2, source, width = "auto", height = "auto") => node("image", key2, { source, width, height }),
  badge: (key2, text, tone = "neutral") => node("badge", key2, { text, tone }),
  spinner: (key2) => node("spinner", key2, {}),
  divider: (key2) => node("divider", key2, {}),
  button: (key2, action, options2 = {}) => node("button", key2, { action, ...options2 }),
  input: (key2, action, options2 = {}) => node("input", key2, { action, ...options2 }),
  toggle: (key2, action, value, label) => node("toggle", key2, { action, value, label: label ?? null }),
  select: (key2, action, options2, value) => node("select", key2, { action, options: options2, value: value ?? null }),
  slider: (key2, action, options2) => node("slider", key2, { action, ...options2 }),
  list: (key2, count, selection = "none") => node("list", key2, { count, selection }),
  tree: (key2, items) => node("tree", key2, { items }),
  table: (key2, columns, count, sort) => node("table", key2, { columns, count, sort: sort ?? null }),
  form: (key2, submit, fields, submitLabel) => node("form", key2, { submit, fields, submit_label: submitLabel ?? null }),
  details: (key2, entries) => node("details", key2, { entries }),
  stream: (key2, lines = [], maxLines) => node("stream", key2, maxLines === void 0 ? { lines } : { lines, max_lines: maxLines }),
  terminal: (key2, terminal) => node("terminal", key2, { terminal })
};
var patch = {
  replace: (node2) => ({ op: "replace", node: node2 }),
  insert: (parent, index, node2) => ({ op: "insert", parent, index, node: node2 }),
  remove: (key2) => ({ op: "remove", key: key2 }),
  setCount: (key2, count) => ({ op: "set_count", key: key2, count }),
  invalidate: (key2) => ({ op: "invalidate", key: key2 }),
  replaceItem: (tree, item) => ({ op: "replace_item", tree, item }),
  append: (key2, lines) => ({ op: "append", key: key2, lines })
};

// node_modules/@krad-ade/extension/dist/framing.js
var HEADER_SEPARATOR = "\r\n\r\n";
var CONTENT_LENGTH = "content-length:";
var MAX_FRAME_BYTES = 64 * 1024 * 1024;
function encodeFrame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}${HEADER_SEPARATOR}`, "ascii"), body]);
}
var FrameError = class extends Error {
};
var FrameDecoder = class {
  buffer = Buffer.alloc(0);
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];
    for (; ; ) {
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd < 0) {
        return messages;
      }
      const length = contentLength(this.buffer.subarray(0, headerEnd).toString("ascii"));
      const start = headerEnd + HEADER_SEPARATOR.length;
      if (this.buffer.length < start + length) {
        return messages;
      }
      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      messages.push(JSON.parse(body));
    }
  }
};
function contentLength(header2) {
  const line = header2.split("\r\n").find((candidate) => candidate.toLowerCase().startsWith(CONTENT_LENGTH));
  if (line === void 0) {
    throw new FrameError("a frame arrived without its Content-Length");
  }
  const length = Number.parseInt(line.slice(CONTENT_LENGTH.length).trim(), 10);
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_FRAME_BYTES) {
    throw new FrameError(`a frame announced an invalid length: ${line}`);
  }
  return length;
}

// node_modules/@krad-ade/extension/dist/rpc.js
var METHOD_NOT_FOUND = -32601;
var REQUEST_FAILED = -32803;
var JSONRPC = "2.0";
var RpcError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var Connection = class {
  output;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  decoder = new FrameDecoder();
  onRequest = (method) => {
    throw new RpcError(METHOD_NOT_FOUND, method);
  };
  onNotification = () => {
  };
  onClose = () => {
  };
  constructor(input, output) {
    this.output = output;
    input.on("data", (chunk) => this.receive(chunk));
    input.on("end", () => this.close());
  }
  handleRequests(handler) {
    this.onRequest = handler;
  }
  handleNotifications(handler) {
    this.onNotification = handler;
  }
  handleClose(handler) {
    this.onClose = handler;
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve4, reject) => {
      this.pending.set(id, { resolve: resolve4, reject });
      this.write({ jsonrpc: JSONRPC, id, method, params });
    });
  }
  notify(method, params) {
    this.write({ jsonrpc: JSONRPC, method, params });
  }
  write(message) {
    this.output.write(encodeFrame(message));
  }
  receive(chunk) {
    for (const message of this.decoder.push(chunk)) {
      this.dispatch(message);
    }
  }
  dispatch(message) {
    if (message.method !== void 0 && message.id !== void 0) {
      void this.answer(message.id, message.method, message.params);
      return;
    }
    if (message.method !== void 0) {
      this.onNotification(message.method, message.params);
      return;
    }
    if (message.id === void 0) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending === void 0) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error !== void 0) {
      pending.reject(new RpcError(message.error.code, message.error.message));
    } else {
      pending.resolve(message.result ?? null);
    }
  }
  async answer(id, method, params) {
    try {
      const result = await this.onRequest(method, params);
      this.write({ jsonrpc: JSONRPC, id, result: result ?? {} });
    } catch (error) {
      const code = error instanceof RpcError ? error.code : REQUEST_FAILED;
      const text = error instanceof Error ? error.message : String(error);
      this.write({ jsonrpc: JSONRPC, id, error: { code, message: text } });
    }
  }
  close() {
    for (const pending of this.pending.values()) {
      pending.reject(new Error("the app closed the connection"));
    }
    this.pending.clear();
    this.onClose();
  }
};

// node_modules/@krad-ade/extension/dist/extension.js
var App = class {
  connection;
  constructor(connection) {
    this.connection = connection;
  }
  request(method, params) {
    return this.connection.request(method, params);
  }
  notify(method, params) {
    this.connection.notify(method, params);
  }
  log(level, message) {
    this.notify("window/log", { level, message });
  }
  toast(message, tone = "neutral") {
    this.notify("window/toast", { message, tone });
  }
  progress(params) {
    this.notify("window/progress", params);
  }
  patchView(view, patches) {
    this.notify("view/patch", { ...view, patches });
  }
  setTitlebarItem(params) {
    this.notify("titlebar/set", params);
  }
  sendTerminal(terminal, text) {
    this.notify("terminal/send", { terminal, text });
  }
  confirm(params) {
    return this.request("window/confirm", params);
  }
  pick(params) {
    return this.request("window/pick", params);
  }
  input(params) {
    return this.request("window/input", params);
  }
  openTerminal(params) {
    return this.request("terminal/open", params);
  }
  openFile(params) {
    return this.request("file/open", params);
  }
  workspaceContext() {
    return this.request("workspace/context", {});
  }
  getSettings() {
    return this.request("settings/get", {});
  }
  getSecret(name) {
    return this.request("secret/get", { name });
  }
  setSecret(name, value) {
    return this.request("secret/set", { name, value });
  }
  runCommand(params) {
    return this.request("command/run", params);
  }
  openView(params) {
    return this.request("view/open", params);
  }
  closeView(view) {
    return this.request("view/close", view);
  }
};
var EXIT_CODE = 0;
function features(definition) {
  const offered = ["window", "workspace", "settings", "secrets", "terminals", "files"];
  if (definition.commands !== void 0)
    offered.push("commands");
  if (definition.views !== void 0)
    offered.push("views");
  if (definition.tools !== void 0)
    offered.push("tools");
  if (definition.hostKinds !== void 0)
    offered.push("host_kinds");
  return offered;
}
function lookup(table, name, what) {
  const found = table?.[name];
  if (found === void 0) {
    throw new RpcError(METHOD_NOT_FOUND, `the extension has no ${what} ${name}`);
  }
  return found;
}
function createExtension(definition, io = {
  input: process.stdin,
  output: process.stdout
}) {
  const connection = new Connection(io.input, io.output);
  const app = new App(connection);
  const exit = io.exit ?? ((code) => process.exit(code));
  let context;
  const ready = () => {
    if (context === void 0) {
      throw new RpcError(METHOD_NOT_FOUND, "the app has not initialized the extension");
    }
    return context;
  };
  const requests = {
    initialize: async (params) => {
      context = { app, init: params };
      await definition.onInitialize?.(context);
      return { features: features(definition) };
    },
    shutdown: async () => {
      await definition.onShutdown?.(ready());
      return {};
    },
    "command/execute": async ({ command, target }) => {
      await lookup(definition.commands, command, "command")(target ?? null, ready());
      return {};
    },
    "view/render": async (view) => lookup(definition.views, view.view, "view").render(view, ready()),
    "view/rows": async (params) => {
      const rows = lookup(definition.views, params.view, "view").rows;
      if (rows === void 0) {
        throw new RpcError(METHOD_NOT_FOUND, `the view ${params.view} has no rows`);
      }
      return rows(params, ready());
    },
    "tool/call": async ({ tool, arguments: args, root }) => {
      const answer = await lookup(definition.tools, tool, "tool")(args ?? {}, root ?? null, ready());
      return typeof answer === "string" ? { content: [{ type: "text", text: answer }], outcome: "done" } : answer;
    },
    "host/list": async ({ kind }) => lookup(definition.hostKinds, kind, "host kind").list(ready()),
    "host/connect": async ({ kind, machine }) => lookup(definition.hostKinds, kind, "host kind").connect(machine, ready())
  };
  const notifications = {
    initialized: () => {
    },
    exit: () => exit(EXIT_CODE),
    "view/event": ({ event, ...view }) => {
      const handler = definition.views?.[view.view]?.onEvent;
      if (handler !== void 0) {
        Promise.resolve(handler(event, view, ready())).catch((error) => app.log("error", `view event failed: ${String(error)}`));
      }
    },
    "view/closed": (view) => definition.views?.[view.view]?.onClose?.(view, ready()),
    "workspace/event": (event) => definition.onWorkspaceEvent?.(event, ready()),
    "settings/changed": (settings) => definition.onSettingsChanged?.(settings, ready())
  };
  connection.handleRequests((method, params) => {
    const handler = requests[method];
    if (handler === void 0) {
      throw new RpcError(METHOD_NOT_FOUND, method);
    }
    return handler(params);
  });
  connection.handleNotifications((method, params) => {
    const handler = notifications[method];
    handler?.(params);
  });
  connection.handleClose(() => exit(EXIT_CODE));
  return { app, connection };
}

// src/cache.ts
import { readdirSync as readdirSync2, readFileSync as readFileSync2, statSync as statSync2 } from "node:fs";
import { join as join2, resolve } from "node:path";

// src/plans.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// src/types.ts
var TASK_STATUSES = ["TODO", "IN PROGRESS", "DONE", "BLOCKED", "REJECTED"];
var HARNESSES = ["claude", "codex", "opencode"];

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
  let current2 = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "|") {
      current2 += "\\|";
      i++;
    } else if (ch === "|") {
      cells.push(current2);
      current2 = "";
    } else {
      current2 += ch;
    }
  }
  cells.push(current2);
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
function formatStatus(status, note) {
  return note ? `${status} (${note})` : status;
}
function replaceCell(old, text) {
  const lead = /^\s/.test(old) ? " " : "";
  const trail = /\s$/.test(old) ? " " : "";
  const minimal = `${lead}${text}${trail}`;
  return minimal.length < old.length ? minimal.padEnd(old.length, " ") : minimal;
}
function replaceRowCell(line, cellIndex, text) {
  const pipes = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      i++;
      continue;
    }
    if (line[i] === "|") pipes.push(i);
  }
  const start = pipes[cellIndex];
  if (start === void 0) return line;
  const end = pipes[cellIndex + 1] ?? line.length;
  const old = line.slice(start + 1, end);
  return line.slice(0, start + 1) + replaceCell(old, text) + line.slice(end);
}
function setStatusInIndex(text, id, status, note, fallback) {
  const { lines, eol } = splitLines(text);
  const table = findTable(lines);
  const statusText = formatStatus(status, note);
  if (!table) {
    const block = [
      "## Execution order & status",
      "",
      "| Plan | Title | Priority | Effort | Depends on | Status |",
      "|------|-------|----------|--------|------------|--------|",
      newRow(id, statusText, fallback),
      ""
    ].join(eol);
    if (text.trim() === "") return block;
    const base = /\r?\n$/.test(text) ? text : text + eol;
    return base + eol + block;
  }
  const statusCol = table.columns.get("status");
  if (statusCol === void 0) return text;
  const row = parseIndex(text).find((r) => r.id === id);
  if (row) {
    lines[row.line] = replaceRowCell(lines[row.line] ?? "", statusCol, statusText);
    return lines.join(eol);
  }
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
        return fallback && fallback.dependsOn.length > 0 ? fallback.dependsOn.join(", ") : "\u2014";
      case "status":
        return statusText;
      default:
        return "";
    }
  });
  lines.splice(table.end, 0, `| ${values.join(" | ")} |`);
  return lines.join(eol);
}
function newRow(id, statusText, fallback) {
  const deps = fallback && fallback.dependsOn.length > 0 ? fallback.dependsOn.join(", ") : "\u2014";
  return `| ${id} | ${fallback?.title ?? ""} | ${fallback?.priority ?? ""} | ${fallback?.effort ?? ""} | ${deps} | ${statusText} |`;
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
function writeStatus(set, id, status, note) {
  const dir = set.dir ?? join(set.root, "plans");
  mkdirSync(dir, { recursive: true });
  const indexPath = set.indexFile ?? join(dir, INDEX_NAME);
  const text = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : MINIMAL_INDEX;
  const task = set.tasks.find((t) => t.id === id);
  const fallback = task ? { title: task.title, priority: task.priority, effort: task.effort, dependsOn: task.dependsOn } : void 0;
  const next = setStatusInIndex(text, id, status, note, fallback);
  if (next !== text || !existsSync(indexPath)) writeFileSync(indexPath, next, "utf8");
}
function runnableTasks(tasks) {
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  return tasks.filter((t) => t.status === "TODO" && t.dependsOn.every((dep) => status.get(dep) === "DONE")).sort((a, b) => a.id.localeCompare(b.id));
}
function slugify(title) {
  const slug = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return slug || "task";
}
function today() {
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function createTask(root, title) {
  const dir = findPlansDir(root) ?? join(root, "plans");
  mkdirSync(dir, { recursive: true });
  const indexPath = join(dir, INDEX_NAME);
  const indexText = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : MINIMAL_INDEX;
  const used = /* @__PURE__ */ new Set();
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
    ""
  ].join("\n");
  writeFileSync(path, body, { encoding: "utf8", flag: "wx" });
  const updated = setStatusInIndex(indexText, id, "TODO", null, {
    title: cleanTitle,
    priority: "P2",
    effort: "M",
    dependsOn: []
  });
  writeFileSync(indexPath, updated, "utf8");
  return path;
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

// src/runner.ts
import { execFile, spawn } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
import { join as join3, resolve as resolve2 } from "node:path";
import { promisify } from "node:util";
var run = promisify(execFile);
var OUTPUT_LIMIT = 16 * 1024 * 1024;
function safeLine(text) {
  return text.replace(/[\r\n]+/g, " ").replace(/["%^&|<>]/g, "").replace(/\s+/g, " ").trim();
}
function taskPrompt(task, planPath, style) {
  if (style === "improve") return safeLine(`/improve execute ${planPath}`);
  return safeLine(
    `Execute the implementation plan in ${planPath}. Read it fully first, follow its steps in order, run every verification command, and honour its STOP conditions. When finished, set the Status cell of row ${task.id} in plans/README.md to DONE, or to BLOCKED (one-line reason) if you stopped. Change no other row.`
  );
}
function editPlanPrompt(planPath, instruction) {
  return safeLine(
    `Edit the implementation plan in ${planPath}. The change: ${instruction} Read the plan fully first. Change only what the request needs and keep the plan's format: the '# Plan NNN: title' heading, the ## Status section and the numbered steps. Do not carry out the plan and do not change code. If the change touches the title, priority, effort or dependencies, update the plan's row in plans/README.md to match, leaving its Status cell and every other row alone.`
  );
}
function improvePrompt(args) {
  return safeLine(`/improve ${args.trim()}`);
}
function splitArgs(extraArgs) {
  return extraArgs.split(/\s+/).filter((part) => part.length > 0);
}
function harnessCommand(harness, prompt, extraArgs, platform = process.platform) {
  const extra = splitArgs(extraArgs);
  const promptArgs = harness === "opencode" ? ["--prompt", prompt] : [prompt];
  const program = harness;
  const rest = [...extra, ...promptArgs];
  if (platform === "win32") return { program: "cmd.exe", args: ["/d", "/s", "/c", program, ...rest] };
  return { program, args: rest };
}
function variantsCommand(harnesses, prompt, platform = process.platform) {
  if (harnesses.length < 2 || harnesses.length > 4) {
    throw new RangeError(`krad variants run needs 2 to 4 agents, got ${harnesses.length}`);
  }
  void platform;
  const args = ["variants", "run"];
  for (const harness of harnesses) args.push("--variant", harness);
  args.push(prompt);
  return { program: "krad", args };
}
function worktreeFor(root, task) {
  const trimmed = root.replace(/[\\/]+$/, "");
  const name = `${task.id}-${task.slug}`;
  return { path: join3(`${trimmed}.worktrees`, name), branch: `tasklist/${name}` };
}
async function isGitRepo(root, git = "git") {
  try {
    const { stdout } = await run(git, ["-C", root, "rev-parse", "--is-inside-work-tree"], { windowsHide: true });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}
function samePath(a, b) {
  const norm = (p) => {
    const full = resolve2(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? full.toLowerCase() : full;
  };
  return norm(a) === norm(b);
}
async function gitOutput(git, args) {
  const { stdout } = await run(git, args, { maxBuffer: OUTPUT_LIMIT, windowsHide: true });
  return stdout;
}
async function branchExists(root, branch, git) {
  try {
    await gitOutput(git, ["-C", root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}
async function createWorktree(root, task, git = "git") {
  const target = worktreeFor(root, task);
  if (existsSync2(target.path)) {
    const listing = await gitOutput(git, ["-C", root, "worktree", "list", "--porcelain"]);
    const known = listing.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
    if (known.some((path) => samePath(path, target.path))) return target;
  }
  if (await branchExists(root, target.branch, git)) {
    await gitOutput(git, ["-C", root, "worktree", "add", target.path, target.branch]);
  } else {
    await gitOutput(git, ["-C", root, "worktree", "add", "-b", target.branch, target.path]);
  }
  return target;
}
var AGENT_STATES = ["idle", "working", "waiting-for-input", "done", "exited", "closed"];
function toState(value) {
  return AGENT_STATES.includes(value) ? value : "idle";
}
function toAgent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw;
  if (typeof r.terminal !== "number") return null;
  return {
    environment: typeof r.environment === "string" ? r.environment : "main",
    terminal: r.terminal,
    state: toState(r.state),
    title: typeof r.title === "string" ? r.title : "",
    harness: typeof r.harness === "string" ? r.harness : null,
    group: typeof r.group === "string" ? r.group : null
  };
}
function toAgents(list) {
  if (!Array.isArray(list)) return [];
  return list.map(toAgent).filter((a) => a !== null);
}
async function findKrad(setting) {
  const candidates = [];
  if (setting.trim()) candidates.push(setting.trim());
  candidates.push("krad", "krad-ade-agents");
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(join3(process.env.LOCALAPPDATA, "Programs", "Krad ADE", "krad.exe"));
  }
  for (const program of [...new Set(candidates)]) {
    try {
      await run(program, ["--version"], { timeout: 5e3, windowsHide: true });
      return { program, prefixArgs: [] };
    } catch {
    }
  }
  return null;
}
function parseWatchLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { snapshot: false, agents: [] };
  }
  if (!parsed || typeof parsed !== "object") return { snapshot: false, agents: [] };
  const message = parsed;
  const snapshot = message.AgentSnapshot;
  if (snapshot && typeof snapshot === "object") return { snapshot: true, agents: toAgents(snapshot.agents) };
  const agent = toAgent(message.AgentEvent);
  return { snapshot: false, agents: agent ? [agent] : [] };
}
var FIRST_DELAY_MS = 2e3;
var MAX_DELAY_MS = 6e4;
var AgentWatcher = class {
  constructor(cli, onChange, log = () => {
  }) {
    this.cli = cli;
    this.onChange = onChange;
    this.log = log;
  }
  child = null;
  stopped = true;
  delay = FIRST_DELAY_MS;
  timer = null;
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.delay = FIRST_DELAY_MS;
    this.launch();
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) child.kill();
  }
  safeLog(message) {
    try {
      this.log(message);
    } catch {
    }
  }
  launch() {
    let child;
    try {
      child = spawn(this.cli.program, [...this.cli.prefixArgs, "agents", "watch", "--json"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      this.safeLog(`krad agents watch failed to start: ${String(error)}`);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    let rest = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      rest += chunk;
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) this.handleLine(line);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      const text = chunk.trim();
      if (text) this.safeLog(`krad agents watch: ${text}`);
    });
    child.on("error", (error) => {
      this.safeLog(`krad agents watch error: ${error.message}`);
    });
    child.stdout?.on("end", () => {
      if (rest.trim()) this.handleLine(rest);
      rest = "";
    });
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopped) return;
      this.safeLog(`krad agents watch exited (code ${code ?? "null"}); restarting in ${this.delay / 1e3}s`);
      this.scheduleRestart();
    });
  }
  scheduleRestart() {
    if (this.stopped) return;
    const wait = this.delay;
    this.delay = Math.min(this.delay * 2, MAX_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.launch();
    }, wait);
  }
  handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.delay = FIRST_DELAY_MS;
    const { snapshot, agents } = parseWatchLine(trimmed);
    for (const agent of agents) {
      try {
        this.onChange(agent, snapshot);
      } catch (error) {
        this.safeLog(`agent watcher callback failed: ${String(error)}`);
      }
    }
  }
};

// src/scheduler.ts
var LIVE_STATES = ["starting", "working", "idle", "waiting-for-input", "unknown"];
function isLive(run3) {
  return run3.endedAt === null && LIVE_STATES.includes(run3.state);
}
function hasStopped(state) {
  return state === "done" || state === "exited" || state === "closed";
}
function verdictFor(status) {
  if (status === "DONE") return "done";
  if (status === "BLOCKED" || status === "REJECTED") return "blocked";
  return "needs-review";
}
function nextLaunches(runnable, runs2, finishedInSession, maxParallel) {
  const live = runs2.filter(isLive);
  const liveIds = new Set(live.map((run3) => run3.taskId));
  const room = Math.max(0, Math.floor(maxParallel) - live.length);
  if (room === 0) return [];
  return [...runnable].filter((task) => !liveIds.has(task.id) && !finishedInSession.has(task.id)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, room);
}
function sessionOver(runnable, runs2, finishedInSession, maxParallel) {
  return !runs2.some(isLive) && nextLaunches(runnable, runs2, finishedInSession, maxParallel).length === 0;
}

// src/view.ts
import { basename as basename2, relative } from "node:path";
var ACTIONS = {
  run: "run",
  // row menu / button: run the task in the group folder
  runWorktree: "run-worktree",
  // run the task in a new git worktree
  variants: "variants",
  // compare agents on this task with Krad variants
  edit: "edit",
  // open the plan file in Krad's editor
  openViewer: "open-viewer",
  // open the plan file in Krad, to read it in its Markdown preview
  quickEdit: "quick-edit",
  // edit the plan with a prompt: an agent changes the Markdown
  setStatus: "set-status",
  // "Change status" button: the app's picker chooses the status
  filter: "filter",
  // select change of the task list filter
  section: "section",
  // select change of the plan section shown
  layout: "layout",
  // header button: side by side <-> stacked panes
  newTask: "new-task",
  refresh: "refresh",
  runNext: "run-next",
  autoRun: "auto-run",
  stop: "stop",
  generate: "generate",
  // write plans with /improve
  reconcile: "reconcile",
  // /improve reconcile
  openTab: "open-tab",
  // Tasks page: open the Tasklist tab of its group
  group: "group"
  // Tasks page: group button, the app's picker chooses the group
};
var KEYS = {
  root: "root",
  header: "header",
  session: "session",
  problems: "problems",
  body: "body",
  tasksPane: "tasks-pane",
  tasks: "tasks",
  // the task list (ui.list, rows served by rows())
  detail: "detail",
  detailTop: "detail-top",
  // the plan pane without the plan text
  plan: "detail-plan",
  // the plan: the section select and the scroll with one section
  planSections: "plan-sections",
  // the section select
  planScroll: "plan-scroll",
  // the scroll with the selected section's Markdown
  tasksPaneHeader: "tasks-pane-header",
  tasksEmpty: "tasks-empty",
  // the sentence that replaces an empty list
  empty: "empty"
};
var FILTERS = ["all", "todo", "running", "done", "blocked"];
var FILTER_LABELS = {
  all: "All",
  todo: "To do",
  running: "Running",
  done: "Done",
  blocked: "Blocked"
};
var busyKey = {
  run: (id) => `${ACTIONS.run}:${id}`,
  runWorktree: (id) => `${ACTIONS.runWorktree}:${id}`,
  runNext: ACTIONS.runNext
};
function isBusy(state, key2) {
  return state.busy?.includes(key2) ?? false;
}
var STATUS_BADGES = {
  TODO: { text: "todo", tone: "neutral" },
  "IN PROGRESS": { text: "in progress", tone: "info" },
  DONE: { text: "done", tone: "success" },
  BLOCKED: { text: "blocked", tone: "error" },
  REJECTED: { text: "rejected", tone: "neutral" }
};
var HARNESS_NAMES = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode"
};
var LIVE_STATES2 = /* @__PURE__ */ new Set(["starting", "working", "idle", "unknown"]);
var PANEL = { background: "panel", border: "border", radius: "lg" };
function runOf(state, taskId) {
  return state.runs.find((run3) => run3.taskId === taskId) ?? null;
}
function isLive2(run3) {
  return run3 !== null && run3.endedAt === null && LIVE_STATES2.has(run3.state);
}
function hasTodo(state) {
  return state.set.tasks.some((task) => task.status === "TODO");
}
function statusBadge(task, run3) {
  if (run3 !== null && run3.endedAt === null) {
    if (LIVE_STATES2.has(run3.state)) return { text: "running", tone: "info" };
    if (run3.state === "waiting-for-input") return { text: "needs you", tone: "warning" };
  }
  return STATUS_BADGES[task.status];
}
function stack(key2, children, style = {}) {
  return ui.flex(key2, children, { direction: "column", align: "stretch", style: { gap: "md", ...style } });
}
function band(key2, children, style = {}) {
  return ui.flex(key2, children, { direction: "row", align: "stretch", style: { gap: "md", ...style } });
}
function iconButton(key2, action, icon, tooltip, enabled = "yes") {
  return ui.button(key2, action, { icon, variant: "ghost", tooltip, enabled });
}
function hrow(key2, children, style = {}, justify = "start") {
  return ui.flex(key2, children, { direction: "row", align: "center", justify, style: { gap: "sm", ...style } });
}
function flow(key2, children, style = {}, justify = "start") {
  return ui.flex(key2, children, { direction: "row", align: "center", justify, wrap: "wrap", style: { gap: "sm", ...style } });
}
function vstack(key2, children, style = {}) {
  return ui.flex(key2, children, { direction: "column", align: "start", style: { gap: "xs", ...style } });
}
function counts(state) {
  const tasks = state.set.tasks;
  return {
    done: tasks.filter((task) => task.status === "DONE").length,
    total: tasks.length,
    running: tasks.filter((task) => isLive2(runOf(state, task.id))).length,
    blocked: tasks.filter((task) => task.status === "BLOCKED").length
  };
}
function doneChip(key2, state) {
  const { done, total } = counts(state);
  return ui.badge(key2, `${done}/${total} done`, total > 0 && done === total ? "success" : "neutral");
}
function filteredTasks(state) {
  const tasks = state.set.tasks;
  switch (state.filter) {
    case "todo":
      return tasks.filter((task) => task.status === "TODO");
    case "running":
      return tasks.filter((task) => isLive2(runOf(state, task.id)) || task.status === "IN PROGRESS");
    case "done":
      return tasks.filter((task) => task.status === "DONE");
    case "blocked":
      return tasks.filter((task) => task.status === "BLOCKED");
    default:
      return tasks;
  }
}
function metaLine(task) {
  return [task.priority, task.effort, task.dependsOn.length > 0 ? `after ${task.dependsOn.join(", ")}` : null].filter(Boolean).join(" \xB7 ");
}
var PANE_W = 380;
var STACK_TASKS_H = 280;
var PANE_PAD = 12;
var APP_ROW_PAD_X = 8;
var ROW_BODY_W = PANE_W - 2 * PANE_PAD - 2 * APP_ROW_PAD_X;
var ROW_PAD = 8;
var ROW_GAP = 8;
var ROW_LEAD_W = 36;
var ROW_STATUS_W = 88;
var ROW_TEXT_W = ROW_BODY_W - 2 * ROW_PAD - ROW_LEAD_W - ROW_STATUS_W - 2 * ROW_GAP;
var TITLE_LINE_CHARS = 26;
function titleLines(title, max = TITLE_LINE_CHARS) {
  const words = title.replace(/`/g, "").replace(/\s+/g, " ").trim().split(" ");
  const take = (limit) => {
    let line = "";
    while (words.length > 0) {
      const next = line ? `${line} ${words[0]}` : words[0];
      if (next.length > limit) break;
      line = next;
      words.shift();
    }
    if (line === "" && words.length > 0) {
      line = words[0].slice(0, limit);
      words[0] = words[0].slice(limit);
    }
    return line;
  };
  const first = take(max);
  let second = take(max);
  if (words.length > 0) {
    words.unshift(...second.split(" "));
    second = `${take(max - 1)}\u2026`;
  }
  return [first, second];
}
function taskRow(state, task) {
  const run3 = runOf(state, task.id);
  const badge = statusBadge(task, run3);
  const id = task.id;
  const [line1, line2] = titleLines(task.title);
  const titleStyle = { size: "sm", weight: "medium", color: "text_strong", wrap: "no_wrap" };
  const children = [
    ui.flex(
      `${id}-lead`,
      [ui.text(`${id}-number`, id, { size: "sm", font: "mono", color: "text_muted", wrap: "no_wrap" })],
      { direction: "column", align: "center", style: { width: { fixed: ROW_LEAD_W } } }
    ),
    vstack(
      `${id}-text`,
      [
        ui.text(`${id}-title`, line1, titleStyle),
        ui.text(`${id}-title-2`, line2 || "\xA0", titleStyle),
        ui.text(`${id}-meta`, metaLine(task) || "\xA0", { size: "xs", color: "text_muted", wrap: "no_wrap" })
      ],
      { width: { fixed: ROW_TEXT_W } }
    ),
    isLive2(run3) ? ui.spinner(`${id}-spinner`) : ui.badge(`${id}-badge`, badge.text, badge.tone)
  ];
  const node2 = ui.flex(id, children, {
    direction: "row",
    align: "center",
    style: { width: { fixed: ROW_BODY_W }, padding: "sm", gap: "sm" }
  });
  return { node: node2 };
}
function taskRows(state, start = 0, end = Number.MAX_SAFE_INTEGER) {
  return filteredTasks(state).slice(start, end).map((task) => taskRow(state, task));
}
function header(state, page = null) {
  const runnable = hasTodo(state) ? "yes" : "no";
  const left = [
    ui.icon("header-icon", "tasks", "text_subtle"),
    ui.text("header-title", "Tasklist", { size: "lg", weight: "bold", color: "text_strong", wrap: "no_wrap" })
  ];
  const group = page?.groups.find((g) => g.value === state.set.root);
  if (page !== null && page.groups.length > 1 && group !== void 0) {
    left.push(
      ui.button("header-group", ACTIONS.group, {
        label: group.label,
        icon: "chevron-down",
        variant: "ghost",
        tooltip: "Switch group"
      })
    );
  } else {
    left.push(
      ui.text("header-folder", basename2(state.set.root) || state.set.root, {
        size: "sm",
        color: "text_muted",
        wrap: "no_wrap"
      })
    );
  }
  if (state.set.dir !== null) {
    const { running, blocked } = counts(state);
    left.push(doneChip("header-done", state));
    if (running > 0) left.push(ui.badge("header-running", `${running} running`, "info"));
    if (blocked > 0) left.push(ui.badge("header-blocked", `${blocked} blocked`, "error"));
  }
  const stacked = state.layout === "stack";
  const toolButtons = [
    iconButton("toolbar-new", ACTIONS.newTask, "add", "New task"),
    iconButton("toolbar-generate", ACTIONS.generate, "magic", "Write plans with /improve"),
    iconButton("toolbar-reconcile", ACTIONS.reconcile, "repeat", "Reconcile plans with /improve"),
    iconButton("toolbar-refresh", ACTIONS.refresh, "refresh", "Refresh"),
    iconButton(
      "toolbar-layout",
      ACTIONS.layout,
      stacked ? "exchange" : "list-view",
      stacked ? "Side by side" : "Stack the panes"
    )
  ];
  if (page !== null) toolButtons.push(iconButton("toolbar-open-tab", ACTIONS.openTab, "open-external", "Open in a tab"));
  const tools = hrow("header-tools", toolButtons, { padding: "xs", gap: "xs", radius: "full", border: "border" });
  const startingNext = isBusy(state, busyKey.runNext);
  const right = [
    tools,
    ui.button("toolbar-run-next", ACTIONS.runNext, {
      label: startingNext ? "Starting\u2026" : "Run next",
      icon: startingNext ? "loading" : "play",
      variant: "secondary",
      enabled: startingNext ? "no" : runnable,
      tooltip: "Run the next TODO task whose dependencies are done"
    }),
    state.session.active ? ui.button("toolbar-stop", ACTIONS.stop, { label: "Stop", icon: "stop", variant: "danger" }) : ui.button("toolbar-auto-run", ACTIONS.autoRun, {
      label: "Auto-run",
      icon: "flash",
      variant: "secondary",
      enabled: runnable,
      tooltip: "Run every TODO task one after another"
    })
  ];
  return flow(
    KEYS.header,
    [flow("header-left", left), flow("header-right", right)],
    { width: "fill", gap: "md" },
    "between"
  );
}
function sessionStrip(state) {
  const { session } = state;
  const parts = [`Auto-run \xB7 ${session.done} of ${session.total} done`];
  if (session.running > 0) parts.push(`${session.running} running`);
  const children = [
    ui.spinner("session-spinner"),
    ui.text("session-text", parts.join(" \xB7 "), { size: "sm", color: "text_default", wrap: "no_wrap" })
  ];
  if (session.message) {
    children.push(ui.text("session-message", session.message, { size: "sm", color: "text_muted", wrap: "wrap" }));
  }
  return flow(KEYS.session, children, {
    width: "fill",
    background: "panel",
    border: "border",
    radius: "md",
    padding: "md"
  });
}
var PROBLEMS_SHOWN = 3;
function problemsPanel(problems) {
  const children = problems.slice(0, PROBLEMS_SHOWN).map((problem, index) => ui.text(`problem-${index}`, problem, { size: "xs", color: "warning", wrap: "wrap" }));
  if (problems.length > PROBLEMS_SHOWN) {
    children.push(
      ui.text("problems-more", `and ${problems.length - PROBLEMS_SHOWN} more`, { size: "xs", color: "text_muted" })
    );
  }
  return vstack(KEYS.problems, children, { padding: "md", border: "border", radius: "md", width: "fill" });
}
var FILTER_EMPTY = {
  all: "No tasks yet.",
  todo: "Nothing left to do.",
  running: "No agent is working on a task.",
  done: "No task is done yet.",
  blocked: "No task is blocked."
};
function tasksPaneHeader(state) {
  const shown = filteredTasks(state).length;
  const total = state.set.tasks.length;
  return hrow(KEYS.tasksPaneHeader, [
    ui.text("tasks-label", "Tasks", { size: "sm", weight: "medium", color: "text_strong", wrap: "no_wrap" }),
    ui.badge("tasks-count", shown === total ? `${total}` : `${shown} of ${total}`)
  ]);
}
function tasksPane(state) {
  const shown = filteredTasks(state).length;
  const filter = ui.select(
    "tasks-filter",
    ACTIONS.filter,
    FILTERS.map((value) => ({ value, label: FILTER_LABELS[value] })),
    state.filter
  );
  const list = shown > 0 ? ui.list(KEYS.tasks, shown, "single") : ui.text(KEYS.tasksEmpty, FILTER_EMPTY[state.filter], { size: "sm", color: "text_muted", wrap: "wrap" });
  const size = state.layout === "stack" ? { width: "fill", height: { fixed: STACK_TASKS_H } } : { width: { fixed: PANE_W } };
  return stack(KEYS.tasksPane, [tasksPaneHeader(state), filter, list], { ...PANEL, ...size, padding: "md" });
}
function planBody(text) {
  const lines = text.replace(/^\s*#[ \t]+Plan[ \t]+\d+[^\n]*(\r?\n)?/i, "").split("\n");
  const start = lines.findIndex((line) => /^##[ \t]+Status[ \t]*\r?$/i.test(line));
  if (start !== -1) {
    let end = lines.findIndex((line, index) => index > start && /^##[ \t]/.test(line));
    if (end === -1) end = lines.length;
    lines.splice(start, end - start);
  }
  return lines.join("\n").replace(/^(\s*\r?\n)+/, "");
}
var WHOLE_PLAN = "\0all";
var ALL_SECTIONS = { value: "all", label: "All" };
var OVERVIEW = "Overview";
function planSections(text) {
  const sections = [];
  let title = OVERVIEW;
  let headingLine = null;
  let lines = [];
  let fence = null;
  const flush = () => {
    const body = lines.join("\n").replace(/^(\s*\r?\n)+/, "").replace(/\s+$/, "");
    if (body || headingLine !== null) sections.push({ title, heading: headingLine, text: body });
  };
  for (const line of planBody(text).split("\n")) {
    const marker = /^[ \t]*(```|~~~)/.exec(line)?.[1];
    if (marker) fence = fence === null ? marker : fence === marker ? null : fence;
    const heading = fence === null && !marker ? /^##[ \t]+(.+?)[ \t#]*\r?$/.exec(line) : null;
    if (heading) {
      flush();
      title = heading[1].replace(/`/g, "").trim();
      headingLine = line.replace(/\s+$/, "");
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}
function shownSection(state, sections) {
  if (state.section === WHOLE_PLAN && state.planText !== null) {
    return { title: WHOLE_PLAN, heading: null, text: planBody(state.planText) };
  }
  return sections.find((s) => s.title === state.section) ?? sections[0] ?? null;
}
var PLAN_MD = "plan-md";
function planMarkdown(state) {
  if (state.planText === null) return "_Cannot read the plan file._";
  if (state.section === WHOLE_PLAN) return planBody(state.planText) || "_Nothing written here yet._";
  const shown = shownSection(state, planSections(state.planText));
  return shown === null || shown.text === "" ? "_Nothing written here yet._" : shown.text;
}
function planParts(state) {
  return [{ key: PLAN_MD, text: planMarkdown(state) }];
}
function planPartNode(part) {
  return ui.markdown(part.key, part.text);
}
function planOutline(state) {
  if (state.planText === null) return "";
  const sections = planSections(state.planText);
  const shown = shownSection(state, sections);
  return JSON.stringify([sections.map((s) => s.title), shown?.title ?? ""]);
}
function sectionValue(index) {
  return `s${index}`;
}
function sectionTitle(planText, value) {
  if (value === ALL_SECTIONS.value) return WHOLE_PLAN;
  const index = /^s(\d+)$/.exec(value)?.[1];
  if (index === void 0 || planText === null) return null;
  return planSections(planText)[Number(index)]?.title ?? null;
}
function relativePath(root, file) {
  const rel = relative(root, file);
  return rel && !rel.startsWith("..") ? rel.split("\\").join("/") : file;
}
function emptyState(key2, text, buttons, style) {
  const children = [
    ui.icon(`${key2}-icon`, "tasks", "text_muted"),
    ui.text(`${key2}-text`, text, { size: "sm", color: "text_subtle", wrap: "wrap" })
  ];
  if (buttons.length > 0) children.push(flow(`${key2}-buttons`, buttons, {}, "center"));
  return ui.flex(key2, children, {
    direction: "column",
    align: "center",
    justify: "center",
    style: { ...PANEL, padding: "xl", gap: "md", ...style }
  });
}
function selectedTask(state) {
  return state.selected === null ? void 0 : state.set.tasks.find((t) => t.id === state.selected);
}
function detailTop(state, task) {
  const run3 = runOf(state, task.id);
  const live = isLive2(run3);
  const badge = statusBadge(task, run3);
  const chips = [];
  if (run3 !== null && run3.endedAt === null && badge.text !== STATUS_BADGES[task.status].text) {
    chips.push(ui.badge("detail-live", badge.text, badge.tone));
  }
  if (task.priority) chips.push(ui.badge("detail-priority", `Priority ${task.priority}`));
  if (task.effort) chips.push(ui.badge("detail-effort", `Effort ${task.effort}`));
  if (task.risk) chips.push(ui.badge("detail-risk", `Risk ${task.risk}`));
  if (task.dependsOn.length > 0) chips.push(ui.badge("detail-depends", `after ${task.dependsOn.join(", ")}`));
  const starting = isBusy(state, busyKey.run(task.id)) || isBusy(state, busyKey.runWorktree(task.id));
  const runControl = live ? [
    ui.spinner("detail-running-spinner"),
    ui.text("detail-running", `Running with ${HARNESS_NAMES[run3.harness] ?? run3.harness}`, {
      size: "sm",
      color: "info",
      wrap: "no_wrap"
    })
  ] : [
    ui.button("detail-run", ACTIONS.run, {
      label: starting ? "Starting\u2026" : "Run",
      icon: starting ? "loading" : "play",
      variant: "primary",
      enabled: starting ? "no" : "yes"
    })
  ];
  const actions = flow("detail-actions", [
    ...runControl,
    ui.button("detail-run-worktree", ACTIONS.runWorktree, {
      label: "Run in worktree",
      icon: "git-branch",
      variant: "secondary",
      enabled: live || starting ? "no" : "yes"
    }),
    ui.button("detail-variants", ACTIONS.variants, { label: "Compare agents", icon: "exchange", variant: "ghost" }),
    iconButton("detail-edit", ACTIONS.edit, "note", "Edit in editor"),
    iconButton("detail-open-viewer", ACTIONS.openViewer, "open-external", "Open in Krad's viewer"),
    iconButton("detail-quick-edit", ACTIONS.quickEdit, "magic", "Edit with a prompt")
  ]);
  const plan = STATUS_BADGES[task.status];
  const statusRow = flow("detail-status-row", [
    ui.text("detail-status-label", "Status", { size: "xs", color: "text_muted", wrap: "no_wrap" }),
    ui.badge("detail-status-badge", plan.text, plan.tone),
    ui.button("detail-status", ACTIONS.setStatus, { label: "Change status", icon: "pencil", variant: "ghost" })
  ]);
  const heading = [
    flow("detail-eyebrow", [
      ui.text("detail-plan-id", `Plan ${task.id}`, { size: "xs", weight: "medium", color: "text_muted", wrap: "no_wrap" }),
      ui.text("detail-file-path", relativePath(state.set.root, task.file), {
        size: "xs",
        font: "mono",
        color: "text_muted",
        wrap: "no_wrap"
      })
    ]),
    ui.text("detail-title", task.title, { size: "lg", weight: "bold", color: "text_strong", wrap: "wrap" })
  ];
  if (chips.length > 0) heading.push(flow("detail-chips", chips));
  const children = [vstack("detail-heading", heading, { gap: "sm", width: "fill" }), actions, statusRow];
  if (run3 !== null) {
    children.push(
      ui.details("detail-run-info", [
        { label: "Agent", value: HARNESS_NAMES[run3.harness] ?? run3.harness },
        { label: "Where", value: run3.cwd },
        { label: "Branch", value: run3.branch ?? "\u2014" },
        { label: "State", value: run3.state },
        { label: "Started", value: run3.startedAt }
      ])
    );
  }
  if (task.statusNote) {
    children.push(ui.text("detail-note", task.statusNote, { size: "sm", color: "warning", wrap: "wrap" }));
  }
  return stack(KEYS.detailTop, children);
}
function planScroll(state) {
  return {
    key: KEYS.planScroll,
    type: "scroll",
    direction: "column",
    style: { height: "fill", padding: "xs" },
    children: planParts(state).map(planPartNode)
  };
}
function sectionSelect(state) {
  if (state.planText === null) return null;
  const sections = planSections(state.planText);
  if (sections.length < 2) return null;
  const shown = shownSection(state, sections);
  const options2 = [
    { ...ALL_SECTIONS },
    ...sections.map((s, index2) => ({ value: sectionValue(index2), label: s.title }))
  ];
  const index = sections.findIndex((s) => s.title === shown?.title);
  const value = shown?.title === WHOLE_PLAN ? ALL_SECTIONS.value : sectionValue(Math.max(0, index));
  return ui.select(KEYS.planSections, ACTIONS.section, options2, value);
}
function planPane(state) {
  const select = sectionSelect(state);
  return stack(KEYS.plan, select === null ? [planScroll(state)] : [select, planScroll(state)], {
    height: "fill",
    gap: "sm"
  });
}
function planSignature(state) {
  if (state.planText === null) return "";
  return JSON.stringify([planOutline(state), planParts(state)]);
}
function taskDetail(state) {
  const task = selectedTask(state);
  if (task === void 0) {
    return emptyState(KEYS.detail, "Select a task to read its plan", [], { height: "fill" });
  }
  return stack(KEYS.detail, [detailTop(state, task), ui.divider("detail-divider"), planPane(state)], {
    ...PANEL,
    height: "fill",
    padding: "lg"
  });
}
function tasklistView(state, page = null) {
  const children = [header(state, page)];
  if (state.session.active) children.push(sessionStrip(state));
  if (state.set.problems.length > 0) children.push(problemsPanel(state.set.problems));
  if (state.set.dir === null) {
    children.push(
      emptyState(
        KEYS.empty,
        "No plans in this folder yet. Write some with /improve or add a task.",
        [
          ui.button(`${KEYS.empty}-generate`, ACTIONS.generate, {
            label: "Write plans with /improve",
            icon: "magic",
            variant: "secondary"
          }),
          ui.button(`${KEYS.empty}-new`, ACTIONS.newTask, { label: "New task", icon: "add", variant: "secondary" })
        ],
        { width: "fill", height: "fill" }
      )
    );
  } else {
    const panes = [tasksPane(state), taskDetail(state)];
    const style = { width: "fill", height: "fill", gap: "lg" };
    children.push(state.layout === "stack" ? stack(KEYS.body, panes, style) : band(KEYS.body, panes, style));
  }
  return stack(KEYS.root, children, { width: "fill", height: "fill", padding: "lg", gap: "lg" });
}
function noGroupView() {
  return stack(
    KEYS.root,
    [emptyState(KEYS.empty, "Open a group to see its tasks.", [], { width: "fill", height: "fill" })],
    { width: "fill", height: "fill", padding: "lg", gap: "lg" }
  );
}
function viewShape(state) {
  const task = selectedTask(state);
  return [
    state.set.dir !== null,
    state.session.active,
    state.set.problems.length > 0,
    filteredTasks(state).length > 0,
    task?.id ?? "",
    state.layout ?? "side"
  ].join("|");
}

// src/main.ts
var run2 = promisify2(execFile2);
var DEFAULTS = {
  harness: "claude",
  style: "direct",
  extraArgs: "",
  maxParallel: 1,
  stopOnFailure: true,
  kradPath: "krad"
};
function options(values) {
  const harness = values["harness"];
  const style = values["execution-style"];
  const extraArgs = values["extra-args"];
  const maxParallel = values["max-parallel"];
  const stopOnFailure = values["stop-on-failure"];
  const kradPath = values["krad-path"];
  return {
    harness: HARNESSES.includes(harness) ? harness : DEFAULTS.harness,
    style: style === "direct" || style === "improve" ? style : DEFAULTS.style,
    extraArgs: typeof extraArgs === "string" ? extraArgs : DEFAULTS.extraArgs,
    maxParallel: typeof maxParallel === "number" && Number.isFinite(maxParallel) ? Math.min(8, Math.max(1, Math.round(maxParallel))) : DEFAULTS.maxParallel,
    stopOnFailure: typeof stopOnFailure === "boolean" ? stopOnFailure : DEFAULTS.stopOnFailure,
    kradPath: typeof kradPath === "string" && kradPath.trim() ? kradPath.trim() : DEFAULTS.kradPath
  };
}
function newUi() {
  return { selected: null, filter: "all", layout: "side", section: null };
}
var current = DEFAULTS;
var runs = [];
var sessions = /* @__PURE__ */ new Map();
var watcher = null;
var kradCli = null;
var kradMissingWarned = false;
var lastStates = /* @__PURE__ */ new Map();
function failure(error) {
  return error instanceof Error ? error.message.split("\n")[0] ?? String(error) : String(error);
}
function samePath2(a, b) {
  const norm = (p) => {
    const full = resolve3(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? full.toLowerCase() : full;
  };
  return norm(a) === norm(b);
}
function isInside(path, folder) {
  const rel = relative2(resolve3(folder), resolve3(path));
  if (rel === "") return true;
  if (rel.startsWith("..") || resolve3(rel) === rel) return false;
  return process.platform === "win32" ? !/^[a-zA-Z]:/.test(rel) : true;
}
function runsOf(root) {
  return runs.filter((r) => samePath2(r.root, root)).reverse();
}
function liveRun(root, taskId) {
  return runs.find((r) => r.taskId === taskId && samePath2(r.root, root) && isLive(r));
}
function sessionOf(root) {
  for (const [key2, session] of sessions) if (samePath2(key2, root)) return session;
  return void 0;
}
function sessionInfo(root) {
  const session = sessionOf(root);
  const running = runsOf(root).filter(isLive).length;
  if (!session) return { active: false, done: 0, total: 0, running, message: null };
  return {
    active: true,
    done: session.done,
    total: session.total,
    running,
    message: null
  };
}
var plans = new PlanCache();
function writeStatusOf(root, id, status, note) {
  writeStatus(loadPlanSet(root), id, status, note);
  plans.invalidate(root);
}
var PAGE = "tasks";
var TAB = "tasklist";
var openViews = /* @__PURE__ */ new Map();
var uiStates = /* @__PURE__ */ new Map();
var pageChoice = null;
function normPath(p) {
  const full = resolve3(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? full.toLowerCase() : full;
}
function refId(ref) {
  return `${ref.view}\0${ref.instance ?? ""}`;
}
function uiOf(view, root) {
  const key2 = `${view}\0${normPath(root)}`;
  let ui2 = uiStates.get(key2);
  if (!ui2) {
    ui2 = newUi();
    uiStates.set(key2, ui2);
  }
  return ui2;
}
function viewState(view, root) {
  const set = plans.planSet(root);
  const ui2 = uiOf(view, root);
  const task = ui2.selected === null ? void 0 : set.tasks.find((t) => t.id === ui2.selected);
  return {
    set,
    runs: runsOf(root),
    selected: ui2.selected,
    planText: task ? plans.planText(task.file) : null,
    session: sessionInfo(root),
    filter: ui2.filter,
    busy: [...busy.get(normPath(root)) ?? []],
    layout: ui2.layout,
    section: ui2.section
  };
}
async function resolvePage(context) {
  const groups = (await context.app.workspaceContext()).groups.map((g) => ({ root: g.root, name: g.name }));
  const picked = pageChoice === null ? void 0 : groups.find((g) => samePath2(g.root, pageChoice));
  const withPlans = groups.find((g) => findPlansDir(g.root) !== null);
  return { root: (picked ?? withPlans ?? groups[0])?.root ?? null, groups };
}
async function openViewOf(ref, context, reresolve) {
  const id = refId(ref);
  let open = openViews.get(id);
  if (!open) {
    open = { ref: { view: ref.view, instance: ref.instance }, root: null, groups: [], shape: null, planSig: "", planOutline: "", planParts: [], state: null };
    openViews.set(id, open);
    reresolve = true;
    if (ref.view === PAGE) Object.assign(open, await resolvePage(context));
    else open.root = ref.instance ?? null;
    if (open.root !== null) uiOf(ref.view, open.root).filter = "all";
    return open;
  }
  if (reresolve) {
    if (ref.view === PAGE) Object.assign(open, await resolvePage(context));
    else open.root = ref.instance ?? null;
  }
  return open;
}
function chromeOf(open) {
  return open.ref.view === PAGE ? { groups: open.groups.map((g) => ({ value: g.root, label: g.name })) } : null;
}
function remember(open, state) {
  open.shape = state === null ? null : viewShape(state);
  open.planSig = state === null ? "" : planSignature(state);
  open.planOutline = state === null ? "" : planOutline(state);
  open.planParts = state === null ? [] : planParts(state);
  open.state = state;
}
function build(open) {
  if (open.root === null) {
    remember(open, null);
    return noGroupView();
  }
  const state = viewState(open.ref.view, open.root);
  remember(open, state);
  return tasklistView(state, chromeOf(open));
}
function patchOpen(open, context, patches) {
  try {
    context.app.patchView(open.ref, patches);
  } catch (error) {
    context.app.log("warn", `refresh of ${open.ref.view} failed: ${failure(error)}`);
  }
}
function replaceOpen(open, context) {
  patchOpen(open, context, [patch.replace(build(open)), patch.invalidate(KEYS.tasks)]);
}
function refreshOpen(open, context) {
  if (open.root === null || open.shape === null) return replaceOpen(open, context);
  const state = viewState(open.ref.view, open.root);
  if (viewShape(state) !== open.shape) return replaceOpen(open, context);
  const patches = [patch.replace(header(state, chromeOf(open)))];
  if (state.session.active) patches.push(patch.replace(sessionStrip(state)));
  if (state.set.problems.length > 0) patches.push(patch.replace(problemsPanel(state.set.problems)));
  if (state.set.dir !== null) {
    patches.push(patch.replace(tasksPaneHeader(state)));
    const shown = filteredTasks(state).length;
    if (shown > 0) patches.push(patch.setCount(KEYS.tasks, shown), patch.invalidate(KEYS.tasks));
  }
  const task = state.selected === null ? void 0 : state.set.tasks.find((t) => t.id === state.selected);
  if (task !== void 0) {
    patches.push(patch.replace(detailTop(state, task)));
    if (planSignature(state) !== open.planSig) patches.push(...planPatches(open, state));
  }
  remember(open, state);
  patchOpen(open, context, patches);
}
function planPatches(open, state) {
  const parts = planParts(state);
  const before = open.planParts;
  const sameNodes = parts.length > 0 && parts.length === before.length && parts.every((part, index) => part.key === before[index].key);
  if (planOutline(state) !== open.planOutline || !sameNodes) return [patch.replace(planPane(state))];
  return parts.filter((part, index) => part.text !== before[index].text).map((part) => patch.replace(planPartNode(part)));
}
function refreshRoot(root, context) {
  for (const open of openViews.values()) {
    if (open.root !== null && samePath2(open.root, root)) refreshOpen(open, context);
  }
}
function refreshAll(context) {
  for (const open of openViews.values()) {
    if (open.ref.view === PAGE) {
      const before = open.root;
      void openViewOf(open.ref, context, true).then(() => before === open.root ? refreshOpen(open, context) : replaceOpen(open, context)).catch((error) => context.app.log("warn", `refresh of the Tasks page failed: ${failure(error)}`));
    } else {
      refreshOpen(open, context);
    }
  }
}
function refreshDetail(open, context) {
  if (open.root === null) return;
  const state = viewState(open.ref.view, open.root);
  if (viewShape(state).split("|").slice(0, 4).join("|") !== (open.shape ?? "").split("|").slice(0, 4).join("|")) {
    return replaceOpen(open, context);
  }
  remember(open, state);
  patchOpen(open, context, [patch.replace(taskDetail(state)), patch.invalidate(KEYS.tasks)]);
}
function refreshList(open, context) {
  if (open.root === null) return;
  const state = viewState(open.ref.view, open.root);
  remember(open, state);
  patchOpen(open, context, [patch.replace(tasksPane(state)), patch.invalidate(KEYS.tasks)]);
}
var busy = /* @__PURE__ */ new Map();
function busyOf(root) {
  const key2 = normPath(root);
  let set = busy.get(key2);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    busy.set(key2, set);
  }
  return set;
}
async function whileBusy(root, key2, context, action) {
  busyOf(root).add(key2);
  refreshRoot(root, context);
  try {
    return await action();
  } finally {
    busyOf(root).delete(key2);
    refreshRoot(root, context);
  }
}
async function openTab(root, context) {
  const existing = [...openViews.values()].find((o) => o.ref.view === TAB && o.root !== null && samePath2(o.root, root));
  const instance = existing?.ref.instance ?? root;
  await context.app.openView({ view: TAB, instance, title: `Tasklist \xB7 ${basename3(root)}` });
}
function findTask(root, id) {
  const set = plans.planSet(root);
  const task = set.tasks.find((t) => t.id === id);
  return task ? { set, task } : null;
}
function planPathOf(root, file) {
  return relative2(root, file).split(sep).join("/");
}
async function rootFor(target, context) {
  if (target?.kind === "group") return target.root;
  const workspace = await context.app.workspaceContext();
  const groups = workspace.groups;
  const containing = (path) => {
    let best = null;
    for (const group of groups) {
      if (isInside(path, group.root) && (best === null || group.root.length > best.length)) best = group.root;
    }
    return best;
  };
  if (target?.kind === "file") {
    const folder = dirname(target.path);
    const parent = dirname(folder);
    if (basename3(target.path).toLowerCase() === "readme.md") {
      const plans2 = findPlansDir(parent);
      if (plans2 !== null && samePath2(plans2, folder)) return parent;
    }
    const group = containing(target.path);
    if (group !== null) return group;
  }
  if (target?.kind === "folder") {
    if (findPlansDir(target.path) !== null) return target.path;
    const group = containing(target.path);
    if (group !== null) return group;
  }
  if (groups.length === 1) return groups[0]?.root ?? null;
  if (groups.length === 0) return null;
  const picked = await context.app.pick({
    title: "Which group?",
    items: groups.map((g) => ({ value: g.root, label: g.name, detail: g.root })),
    mode: "one"
  });
  return picked?.[0] ?? null;
}
async function plansDirty(root) {
  try {
    const { stdout } = await run2("git", ["-C", root, "status", "--porcelain", "--", "plans"], { windowsHide: true });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
async function runTask(root, task, mode, context) {
  const { app } = context;
  if (liveRun(root, task.id)) {
    app.toast(`Task ${task.id} is already running`, "info");
    return false;
  }
  let cwd = root;
  let worktree = null;
  let branch = null;
  const previous = { status: task.status, note: task.statusNote };
  let statusWritten = false;
  try {
    if (mode === "worktree") {
      if (!await isGitRepo(root)) {
        app.toast("Run in a worktree needs a git repository", "error");
        return false;
      }
      if (await plansDirty(root)) {
        app.toast("Uncommitted plan edits will not be in the worktree", "info");
      }
      const created = await createWorktree(root, task);
      cwd = created.path;
      worktree = created.path;
      branch = created.branch;
    }
    const planPath = planPathOf(root, task.file);
    writeStatusOf(root, task.id, "IN PROGRESS", null);
    statusWritten = true;
    const harness = current.harness;
    const terminal = await app.openTerminal({
      title: `task ${task.id} \xB7 ${harness}`,
      cwd,
      zone: "session",
      command: harnessCommand(harness, taskPrompt(task, planPath, current.style), current.extraArgs)
    });
    runs.push({
      taskId: task.id,
      root,
      terminal,
      harness,
      mode,
      cwd,
      worktree,
      branch,
      state: "starting",
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      endedAt: null
    });
    await ensureWatcher(context);
    refreshRoot(root, context);
    app.toast(`Started task ${task.id} with ${harness}`, "success");
    return true;
  } catch (error) {
    app.toast(`Task ${task.id} did not start: ${failure(error)}`, "error");
    if (statusWritten) {
      try {
        writeStatusOf(root, task.id, previous.status, previous.note);
      } catch (restoreError) {
        app.log("warn", `could not restore the status of ${task.id}: ${failure(restoreError)}`);
      }
    }
    refreshRoot(root, context);
    return false;
  }
}
async function runVariants(root, task, context) {
  const { app } = context;
  const picked = await app.pick({
    title: "Compare agents",
    items: HARNESSES.map((h) => ({ value: h, label: h })),
    mode: "many"
  });
  if (picked === null) return;
  if (picked.length < 2 || picked.length > 4) {
    app.toast("Pick 2 to 4 agents to compare", "warning");
    return;
  }
  try {
    const harnesses = picked.filter((h) => HARNESSES.includes(h));
    await app.openTerminal({
      title: `variants \xB7 ${task.id}`,
      cwd: root,
      zone: "utilities",
      command: variantsCommand(harnesses, taskPrompt(task, planPathOf(root, task.file), "direct"))
    });
    app.toast("Variants started \u2014 compare them in Krad's Variants view", "success");
  } catch (error) {
    app.toast(`Variants did not start: ${failure(error)}`, "error");
  }
}
async function openImprove(root, args, context) {
  try {
    await context.app.openTerminal({
      title: "improve",
      cwd: root,
      zone: "session",
      command: harnessCommand(current.harness, improvePrompt(args), current.extraArgs)
    });
  } catch (error) {
    context.app.toast(`Could not start /improve: ${failure(error)}`, "error");
  }
}
async function ensureWatcher(context) {
  if (watcher !== null) return;
  kradCli ??= await findKrad(current.kradPath);
  if (kradCli === null) {
    if (!kradMissingWarned) {
      kradMissingWarned = true;
      context.app.toast(
        'Cannot find the krad CLI; set "Krad CLI" in the extension settings. Task states will not update by themselves \u2014 set them in the tab.',
        "warning"
      );
    }
    return;
  }
  if (watcher !== null) return;
  watcher = new AgentWatcher(
    kradCli,
    (agent) => onAgentChange(agent, context),
    (message) => context.app.log("warn", message)
  );
  watcher.start();
}
function stopWatcherIfIdle() {
  if (watcher === null) return;
  if (runs.some(isLive) || sessions.size > 0) return;
  watcher.stop();
  watcher = null;
}
function runForAgent(agent) {
  const byTerminal = runs.find((r) => r.terminal === agent.terminal && r.endedAt === null);
  if (byTerminal) return byTerminal;
  if (runs.some((r) => r.terminal === agent.terminal)) return void 0;
  const match = /^task (\d{3}) · /.exec(agent.title);
  if (!match) return void 0;
  const adopted = runs.find((r) => r.taskId === match[1] && r.state === "starting" && r.endedAt === null);
  if (adopted) adopted.terminal = agent.terminal;
  return adopted;
}
function onAgentChange(agent, context) {
  const record = runForAgent(agent);
  if (!record) return;
  const before = lastStates.get(agent.terminal);
  lastStates.set(agent.terminal, agent.state);
  record.state = agent.state;
  if (agent.state === "waiting-for-input" && before !== "waiting-for-input") {
    context.app.toast(
      `Task ${record.taskId} waits for you in "task ${record.taskId} \xB7 ${record.harness}"`,
      "warning"
    );
  }
  if (!hasStopped(agent.state)) {
    refreshRoot(record.root, context);
    return;
  }
  finishRun(record, context);
}
function finishRun(record, context) {
  const { app } = context;
  const root = record.root;
  let status = "IN PROGRESS";
  let note = null;
  try {
    const source = record.mode === "worktree" && record.worktree ? loadPlanSet(record.worktree) : loadPlanSet(root);
    const task = source.tasks.find((t) => t.id === record.taskId);
    if (task) {
      status = task.status;
      note = task.statusNote;
    }
  } catch (error) {
    app.log("warn", `could not read the status of ${record.taskId}: ${failure(error)}`);
  }
  const verdict = verdictFor(status);
  if (record.mode === "worktree" && verdict !== "needs-review") {
    const mirrored = status === "DONE" ? [note, `in worktree ${record.branch ?? record.worktree}`].filter(Boolean).join(" \u2014 ") : note;
    try {
      writeStatusOf(root, record.taskId, status, mirrored || null);
    } catch (error) {
      app.log("warn", `could not mirror the status of ${record.taskId}: ${failure(error)}`);
    }
  }
  if (verdict === "needs-review") {
    app.toast(`Task ${record.taskId} stopped without updating its status \u2014 review it`, "warning");
  }
  record.endedAt = (/* @__PURE__ */ new Date()).toISOString();
  const session = sessionOf(root);
  if (session) {
    session.finished.add(record.taskId);
    if (verdict === "done") session.done += 1;
    else session.blockedOrReview.push({ id: record.taskId, why: verdict === "blocked" ? "blocked" : "needs review" });
  }
  refreshRoot(root, context);
  void advanceSession(root, context);
  stopWatcherIfIdle();
}
async function startAutoRun(root, context) {
  const { app } = context;
  if (sessionOf(root)) {
    app.toast("An auto-run is already going in this group", "info");
    return;
  }
  const set = plans.planSet(root);
  if (runnableTasks(set.tasks).length === 0) {
    app.toast("Nothing to run: every TODO task waits on another one", "info");
    return;
  }
  let maxParallel = current.maxParallel;
  if (maxParallel > 1 && !await isGitRepo(root)) {
    const answer2 = await app.confirm({
      title: "Run one at a time?",
      detail: "Running tasks in parallel needs a git repository for the worktrees.",
      confirm: "Run one at a time",
      tone: "warning"
    });
    if (answer2 !== "confirmed") return;
    maxParallel = 1;
  }
  const total = set.tasks.filter((t) => t.status === "TODO").length;
  const answer = await app.confirm({
    title: `Start an auto-run of ${total} tasks with ${current.harness}, ${maxParallel} at a time?`,
    detail: "Agents will edit files in this group.",
    confirm: "Start",
    tone: "warning"
  });
  if (answer !== "confirmed") return;
  const session = {
    finished: /* @__PURE__ */ new Set(),
    blockedOrReview: [],
    done: 0,
    total,
    token: `tasklist-${root}`,
    chain: Promise.resolve()
  };
  sessions.set(root, session);
  sessionParallel.set(session, maxParallel);
  app.progress({ token: session.token, state: "begin", title: "Tasklist auto-run" });
  app.setTitlebarItem({ item: "tasklist", active: true });
  refreshRoot(root, context);
  await advanceSession(root, context);
}
var sessionParallel = /* @__PURE__ */ new WeakMap();
function endSession(root, context, message, tone) {
  const session = sessionOf(root);
  if (!session) return;
  for (const [key2, value] of sessions) if (value === session) sessions.delete(key2);
  context.app.progress({ token: session.token, state: "end" });
  if (sessions.size === 0) context.app.setTitlebarItem({ item: "tasklist", active: false });
  context.app.toast(message, tone);
  refreshRoot(root, context);
  stopWatcherIfIdle();
}
function advanceSession(root, context) {
  const session = sessionOf(root);
  if (!session) return Promise.resolve();
  session.chain = session.chain.then(() => advanceOnce(root, session, context)).catch((error) => {
    context.app.log("error", `auto-run step failed: ${failure(error)}`);
  });
  return session.chain;
}
async function advanceOnce(root, session, context) {
  if (sessionOf(root) !== session) return;
  const failed2 = session.blockedOrReview[0];
  if (current.stopOnFailure && failed2) {
    endSession(root, context, `Auto-run stopped: task ${failed2.id} ${failed2.why}`, "warning");
    return;
  }
  const maxParallel = sessionParallel.get(session) ?? current.maxParallel;
  const mode = maxParallel === 1 ? "here" : "worktree";
  const launches = nextLaunches(runnableTasks(plans.planSet(root).tasks), runsOf(root), session.finished, maxParallel);
  for (const task of launches) {
    if (sessionOf(root) !== session) return;
    const started = await runTask(root, task, mode, context);
    if (!started) {
      session.finished.add(task.id);
      session.blockedOrReview.push({ id: task.id, why: "needs review" });
    }
  }
  if (sessionOf(root) !== session) return;
  if (current.stopOnFailure && session.blockedOrReview[0]) {
    const first = session.blockedOrReview[0];
    endSession(root, context, `Auto-run stopped: task ${first.id} ${first.why}`, "warning");
    return;
  }
  if (sessionOver(runnableTasks(plans.planSet(root).tasks), runsOf(root), session.finished, maxParallel)) {
    endSession(root, context, `Auto-run finished: ${session.done}/${session.total} tasks done`, "success");
    return;
  }
  context.app.progress({ token: session.token, state: "report", message: `${session.done} of ${session.total} done` });
  refreshRoot(root, context);
}
async function stopAutoRun(root, context) {
  if (!sessionOf(root)) {
    context.app.toast("No auto-run is going in this group", "info");
    return;
  }
  const answer = await context.app.confirm({
    title: "Stop the auto-run?",
    detail: "Agents already running keep working.",
    confirm: "Stop",
    tone: "warning"
  });
  if (answer !== "confirmed") return;
  endSession(root, context, "Auto-run stopped. Agents already running keep working.", "info");
}
async function runNext(root, context) {
  const task = runnableTasks(plans.planSet(root).tasks).find((t) => !liveRun(root, t.id));
  if (!task) {
    context.app.toast("Nothing to run: every TODO task waits on another one", "info");
    return;
  }
  await runTask(root, task, "here", context);
}
async function taskAction(open, root, action, id, context) {
  const found = findTask(root, id);
  if (!found) {
    context.app.toast(`Task ${id} is not in the plans folder any more`, "warning");
    refreshRoot(root, context);
    return;
  }
  const { task } = found;
  switch (action) {
    case ACTIONS.run:
      await whileBusy(root, busyKey.run(task.id), context, () => runTask(root, task, "here", context));
      return;
    case ACTIONS.runWorktree:
      await whileBusy(root, busyKey.runWorktree(task.id), context, () => runTask(root, task, "worktree", context));
      return;
    case ACTIONS.variants:
      await runVariants(root, task, context);
      return;
    case ACTIONS.edit:
    case ACTIONS.openViewer:
      await context.app.openFile({ path: task.file });
      return;
    case ACTIONS.quickEdit:
      await editWithPrompt(root, task, context);
      return;
  }
}
async function onViewEvent(event, ref, context) {
  const { app } = context;
  const open = await openViewOf(ref, context, false);
  const root = open.root;
  if (root === null) return;
  const ui2 = uiOf(open.ref.view, root);
  try {
    if (event.kind === "choose" && event.node === KEYS.tasks) {
      ui2.selected = event.items[0] ?? null;
      ui2.section = null;
      refreshDetail(open, context);
      return;
    }
    if (event.kind === "click") {
      switch (event.action) {
        case ACTIONS.newTask:
          return await newTask(root, context, open);
        case ACTIONS.generate:
          return await generate(root, context);
        case ACTIONS.reconcile:
          return await openImprove(root, "reconcile", context);
        case ACTIONS.refresh:
          return refreshAll(context);
        case ACTIONS.openTab:
          return await openTab(root, context);
        case ACTIONS.runNext:
          return void await whileBusy(root, busyKey.runNext, context, () => runNext(root, context));
        case ACTIONS.autoRun:
          return await startAutoRun(root, context);
        case ACTIONS.stop:
          return await stopAutoRun(root, context);
        case ACTIONS.group:
          return await switchGroup(open, context);
        case ACTIONS.setStatus:
          return await changeStatus(root, ui2, context);
        case ACTIONS.layout:
          ui2.layout = ui2.layout === "stack" ? "side" : "stack";
          return replaceOpen(open, context);
        case ACTIONS.run:
        case ACTIONS.runWorktree:
        case ACTIONS.variants:
        case ACTIONS.edit:
        case ACTIONS.openViewer:
        case ACTIONS.quickEdit:
          if (ui2.selected !== null) await taskAction(open, root, event.action, ui2.selected, context);
          return;
      }
      return;
    }
    if (event.kind === "select" && event.action === ACTIONS.section) {
      const state = viewState(open.ref.view, root);
      const title = sectionTitle(state.planText, event.value);
      if (title === null) return;
      ui2.section = title;
      const next = { ...state, section: title };
      remember(open, next);
      const select = sectionSelect(next);
      patchOpen(open, context, select === null ? [patch.replace(planScroll(next))] : [patch.replace(select), patch.replace(planScroll(next))]);
      return;
    }
    if (event.kind === "select" && event.action === ACTIONS.filter) {
      if (FILTERS.includes(event.value)) ui2.filter = event.value;
      return refreshList(open, context);
    }
  } catch (error) {
    app.toast(failure(error), "error");
    refreshRoot(root, context);
  }
}
async function switchGroup(open, context) {
  if (open.ref.view !== PAGE || open.groups.length < 2) return;
  const picked = await context.app.pick({
    title: "Show the tasks of which group?",
    items: open.groups.map((g) => ({ value: g.root, label: g.name, detail: g.root })),
    mode: "one"
  });
  const root = picked?.[0];
  if (!root) return;
  pageChoice = root;
  await openViewOf(open.ref, context, true);
  if (open.root !== null) uiOf(open.ref.view, open.root).filter = "all";
  replaceOpen(open, context);
}
async function changeStatus(root, ui2, context) {
  if (ui2.selected === null) return;
  const found = findTask(root, ui2.selected);
  if (!found) return;
  const { task } = found;
  const picked = await context.app.pick({
    title: `Status of plan ${task.id}`,
    items: TASK_STATUSES.map((status2) => ({
      value: status2,
      label: status2,
      detail: status2 === task.status ? "current" : null
    })),
    mode: "one"
  });
  const status = picked?.[0];
  if (status === void 0 || !TASK_STATUSES.includes(status)) return;
  let note = null;
  if (status === "BLOCKED" || status === "REJECTED") {
    note = await context.app.input({ title: "Reason (one line)" });
    if (note === null) return;
    note = note.trim() || null;
  } else if (status === task.status) {
    return;
  }
  writeStatusOf(root, task.id, status, note);
  refreshAll(context);
}
async function editWithPrompt(root, task, context) {
  const { app } = context;
  const planPath = planPathOf(root, task.file);
  const instruction = await app.input({
    title: `Edit plan ${task.id} with ${current.harness}`,
    placeholder: "What should change? e.g. split step 3 in two, add a test for the parser"
  });
  if (instruction === null || !instruction.trim()) return;
  try {
    await app.openTerminal({
      title: `edit ${task.id} \xB7 ${current.harness}`,
      cwd: root,
      zone: "session",
      command: harnessCommand(current.harness, editPlanPrompt(planPath, instruction), current.extraArgs)
    });
    watchPlans(root, context);
    app.toast(`Editing plan ${task.id} with ${current.harness}; the plan refreshes as it changes`, "info");
  } catch (error) {
    app.toast(`Could not start the agent: ${failure(error)}`, "error");
  }
}
var PLANS_WATCH_MS = 60 * 60 * 1e3;
var plansWatches = /* @__PURE__ */ new Map();
function watchPlans(root, context) {
  const dir = findPlansDir(root);
  if (dir === null) return;
  const key2 = normPath(root);
  const existing = plansWatches.get(key2);
  if (existing) {
    existing.expiry.refresh();
    return;
  }
  try {
    const entry = {
      watcher: watch(dir, () => {
        if (entry.debounce) clearTimeout(entry.debounce);
        entry.debounce = setTimeout(() => {
          entry.debounce = null;
          plans.invalidate(root);
          refreshRoot(root, context);
        }, 300);
      }),
      debounce: null,
      expiry: setTimeout(() => unwatchPlans(key2), PLANS_WATCH_MS)
    };
    entry.watcher.on("error", () => unwatchPlans(key2));
    plansWatches.set(key2, entry);
  } catch (error) {
    context.app.log("warn", `cannot watch ${dir}: ${failure(error)}`);
  }
}
function unwatchPlans(key2) {
  const entry = plansWatches.get(key2);
  if (!entry) return;
  plansWatches.delete(key2);
  if (entry.debounce) clearTimeout(entry.debounce);
  clearTimeout(entry.expiry);
  entry.watcher.close();
}
async function newTask(root, context, open = null) {
  const title = await context.app.input({
    title: "New task",
    placeholder: "What should be true when it is done?"
  });
  if (title === null || !title.trim()) return;
  const file = createTask(root, title);
  plans.invalidate(root);
  if (open !== null) {
    const ui2 = uiOf(open.ref.view, root);
    ui2.selected = basename3(file).slice(0, 3);
  }
  refreshRoot(root, context);
  await context.app.openFile({ path: file });
}
async function generate(root, context) {
  const answer = await context.app.input({
    title: "Ask /improve",
    value: "",
    placeholder: "empty = full audit; or: plan <what to build>, quick, security, next ..."
  });
  if (answer === null) return;
  await openImprove(root, answer, context);
}
function failed(text) {
  return { content: [{ type: "text", text }], outcome: "failed" };
}
async function toolRoot(root, context) {
  if (root) return root;
  const workspace = await context.app.workspaceContext();
  return workspace.groups[0]?.root ?? null;
}
async function listTool(_args, root, context) {
  const where = await toolRoot(root, context);
  if (where === null) return failed("No group is open.");
  const set = loadPlanSet(where);
  if (set.dir === null) return `No plans folder in ${where}.`;
  const lines = [`plans: ${set.dir}`];
  for (const task of set.tasks) {
    const deps = task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "-";
    const status = task.statusNote ? `${task.status} \u2014 ${task.statusNote}` : task.status;
    lines.push(`${task.id}	${status}	${task.title}	after: ${deps}	${planPathOf(where, task.file)}`);
  }
  return lines.join("\n");
}
async function setStatusTool(args, root, context) {
  const where = await toolRoot(root, context);
  if (where === null) return failed("No group is open.");
  const input = args && typeof args === "object" ? args : {};
  const id = input["id"];
  const status = input["status"];
  const note = input["note"];
  if (typeof id !== "string" || !/^\d{3}$/.test(id)) return failed("id must be a three-digit plan id, e.g. 003.");
  if (typeof status !== "string" || !TASK_STATUSES.includes(status)) {
    return failed(`status must be one of ${TASK_STATUSES.join(", ")}.`);
  }
  const set = loadPlanSet(where);
  if (set.dir === null) return failed(`No plans folder in ${where}.`);
  if (!set.tasks.some((t) => t.id === id)) return failed(`No task ${id} in ${set.dir}.`);
  const line = typeof note === "string" ? note.replace(/[\r\n]+/g, " ").trim() || null : null;
  writeStatus(set, id, status, line);
  plans.invalidate(where);
  refreshAll(context);
  return `Task ${id} is now ${status}.`;
}
var NO_ROWS = { kind: "list", rows: [] };
async function listRows(params, context) {
  if (params.node !== KEYS.tasks) return NO_ROWS;
  const open = await openViewOf(params, context, false);
  if (open.root === null) return NO_ROWS;
  open.state ??= viewState(open.ref.view, open.root);
  return { kind: "list", rows: taskRows(open.state, params.start, params.end) };
}
function closeView(ref) {
  const open = openViews.get(refId(ref));
  openViews.delete(refId(ref));
  if (open && open.ref.view === TAB && open.root !== null) uiStates.delete(`${TAB}\0${normPath(open.root)}`);
}
var sharedView = {
  async render(view, context) {
    return build(await openViewOf(view, context, true));
  },
  rows(params, context) {
    return listRows(params, context);
  },
  onEvent(event, view, context) {
    return onViewEvent(event, view, context);
  },
  onClose(view) {
    closeView(view);
  }
};
async function withRoot(target, context, action) {
  const root = await rootFor(target, context);
  if (root === null) {
    context.app.toast("Open a group first.", "info");
    return;
  }
  await action(root);
}
createExtension({
  async onInitialize(context) {
    current = options(await context.app.getSettings());
  },
  onShutdown() {
    watcher?.stop();
    watcher = null;
    for (const key2 of [...plansWatches.keys()]) unwatchPlans(key2);
  },
  onSettingsChanged(values, context) {
    const before = current.kradPath;
    current = options(values);
    if (current.kradPath !== before) {
      kradCli = null;
      kradMissingWarned = false;
    }
    refreshAll(context);
  },
  onWorkspaceEvent(event, context) {
    if (event.kind !== "file_saved") return;
    plans.invalidate();
    const inPlans = /[\\/]plans[\\/]/i.test(event.path);
    for (const open of openViews.values()) {
      if (open.ref.view === PAGE && inPlans) {
        void openViewOf(open.ref, context, true).then(() => replaceOpen(open, context)).catch((error) => context.app.log("warn", `refresh of the Tasks page failed: ${failure(error)}`));
        continue;
      }
      const dir = open.root === null ? null : findPlansDir(open.root);
      if (dir !== null && isInside(event.path, dir)) refreshOpen(open, context);
    }
  },
  commands: {
    "tasklist.open": (target, context) => withRoot(target, context, (root) => openTab(root, context)),
    "tasklist.refresh": (_target, context) => refreshAll(context),
    "tasklist.new-task": (target, context) => withRoot(target, context, (root) => newTask(root, context)),
    "tasklist.generate": (target, context) => withRoot(target, context, (root) => generate(root, context)),
    "tasklist.reconcile": (target, context) => withRoot(target, context, (root) => openImprove(root, "reconcile", context)),
    "tasklist.run-next": (target, context) => withRoot(target, context, (root) => runNext(root, context)),
    "tasklist.auto-run": (target, context) => withRoot(target, context, (root) => startAutoRun(root, context)),
    "tasklist.stop": (target, context) => withRoot(target, context, (root) => stopAutoRun(root, context))
  },
  views: {
    [PAGE]: sharedView,
    [TAB]: sharedView
  },
  tools: {
    tasklist_list: listTool,
    tasklist_set_status: setStatusTool
  }
});
