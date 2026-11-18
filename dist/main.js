// node_modules/@krad-ade/extension/dist/view.js
function node(type, key, fields) {
  return { key, type, ...fields };
}
var ui = {
  flex: (key, children, options = {}) => node("flex", key, { ...options, children }),
  row: (key, children, style = {}) => node("flex", key, { direction: "row", style, children }),
  column: (key, children, style = {}) => node("flex", key, { direction: "column", align: "stretch", style, children }),
  stack: (key, children, style = {}) => node("stack", key, { style, children }),
  grid: (key, columns, children, style = {}) => node("grid", key, { columns, style, children }),
  scroll: (key, children, direction = "column") => node("scroll", key, { direction, children }),
  text: (key, text, style = {}) => node("text", key, { text, style }),
  markdown: (key, text) => node("markdown", key, { text }),
  icon: (key, icon, color) => node("icon", key, { icon, color: color ?? null }),
  image: (key, source, width = "auto", height = "auto") => node("image", key, { source, width, height }),
  badge: (key, text, tone = "neutral") => node("badge", key, { text, tone }),
  spinner: (key) => node("spinner", key, {}),
  divider: (key) => node("divider", key, {}),
  button: (key, action, options = {}) => node("button", key, { action, ...options }),
  input: (key, action, options = {}) => node("input", key, { action, ...options }),
  toggle: (key, action, value, label) => node("toggle", key, { action, value, label: label ?? null }),
  select: (key, action, options, value) => node("select", key, { action, options, value: value ?? null }),
  slider: (key, action, options) => node("slider", key, { action, ...options }),
  list: (key, count, selection = "none") => node("list", key, { count, selection }),
  tree: (key, items) => node("tree", key, { items }),
  table: (key, columns, count, sort) => node("table", key, { columns, count, sort: sort ?? null }),
  form: (key, submit, fields, submitLabel) => node("form", key, { submit, fields, submit_label: submitLabel ?? null }),
  details: (key, entries) => node("details", key, { entries }),
  stream: (key, lines = [], maxLines) => node("stream", key, maxLines === void 0 ? { lines } : { lines, max_lines: maxLines }),
  terminal: (key, terminal) => node("terminal", key, { terminal })
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
function contentLength(header) {
  const line = header.split("\r\n").find((candidate) => candidate.toLowerCase().startsWith(CONTENT_LENGTH));
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
    "settings/changed": (settings2) => definition.onSettingsChanged?.(settings2, ready())
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

// src/main.ts
var settings = {};
var current = null;
createExtension({
  async onInitialize(context) {
    settings = await context.app.getSettings();
  },
  onSettingsChanged(values) {
    settings = values;
  },
  commands: {
    "tasklist.open": async (target, context) => {
      let root;
      if (target?.kind === "group") {
        root = target.root;
      } else {
        const workspace = await context.app.workspaceContext();
        root = workspace.groups[0]?.root;
      }
      if (!root) {
        context.app.toast("Open a group first.");
        return;
      }
      await context.app.openView({ view: "tasklist", instance: root, title: "Tasklist" });
    }
  },
  views: {
    tasklist: {
      render() {
        void settings;
        void current;
        return ui.column("root", [ui.text("placeholder", "Tasklist is being built.")]);
      }
    }
  }
});
