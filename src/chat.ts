// Opening an agent as a native Krad chat (the app's `chat/open` request).
import type { App } from "@krad-ade/extension";
import { INVALID_PARAMS, METHOD_NOT_FOUND, RpcError } from "@krad-ade/extension";
import type { Harness } from "./types.js";

/** Params of `chat/open`. worktree is the name of a new git worktree Krad creates as <repo>.worktrees/<name>. */
export interface OpenChatParams {
  task: string;
  agent?: Harness | null;
  title?: string | null;
  worktree?: string | null;
  group_root?: string | null;
}

export interface OpenChatResult {
  terminal: number;
  session: number;
}

/** Thrown when the app has no `chat/open` (an older Krad): the caller should stop asking. */
export class ChatsUnsupported extends Error {}

/**
 * Asks the app to open a chat. SDK 0.4.0 has no typed method for `chat/open`, so this goes through
 * the generic request. Throws ChatsUnsupported when the app does not know the method (or its
 * params, or answers with something that is not a chat); other errors are rethrown as they are.
 */
export async function openChat(app: App, params: OpenChatParams): Promise<OpenChatResult> {
  const request = app.request as unknown as (method: string, params: unknown) => Promise<unknown>;
  let result: unknown;
  try {
    result = await request.call(app, "chat/open", params);
  } catch (error) {
    if (error instanceof RpcError && (error.code === METHOD_NOT_FOUND || error.code === INVALID_PARAMS)) {
      throw new ChatsUnsupported(`chat/open is not supported (${error.code}: ${error.message})`);
    }
    throw error;
  }
  const r = (result ?? {}) as Record<string, unknown>;
  if (typeof r.terminal !== "number") {
    throw new ChatsUnsupported(`chat/open answered without a terminal id: ${JSON.stringify(result)}`);
  }
  return { terminal: r.terminal, session: typeof r.session === "number" ? r.session : -1 };
}
