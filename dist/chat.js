// node_modules/@krad-ade/extension/dist/framing.js
var MAX_FRAME_BYTES = 64 * 1024 * 1024;

// node_modules/@krad-ade/extension/dist/rpc.js
var METHOD_NOT_FOUND = -32601;
var INVALID_PARAMS = -32602;
var RpcError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};

// src/chat.ts
var ChatsUnsupported = class extends Error {
};
async function openChat(app, params) {
  const request = app.request;
  let result;
  try {
    result = await request.call(app, "chat/open", params);
  } catch (error) {
    if (error instanceof RpcError && (error.code === METHOD_NOT_FOUND || error.code === INVALID_PARAMS)) {
      throw new ChatsUnsupported(`chat/open is not supported (${error.code}: ${error.message})`);
    }
    throw error;
  }
  const r = result ?? {};
  if (typeof r.terminal !== "number") {
    throw new ChatsUnsupported(`chat/open answered without a terminal id: ${JSON.stringify(result)}`);
  }
  return { terminal: r.terminal, session: typeof r.session === "number" ? r.session : -1 };
}
export {
  ChatsUnsupported,
  openChat
};
