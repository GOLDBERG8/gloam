/**
 * The few Telegram Bot API shapes and calls the community helper uses.
 * Server only. Plain fetch, no SDK. Every call is best effort: a failure is
 * returned, never thrown, so one bad call cannot break the webhook.
 */

export type TgUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type TgChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  username?: string;
  title?: string;
  is_forum?: boolean;
};

export type TgEntity = {
  type: string;
  offset: number;
  length: number;
  user?: TgUser;
};

/** One size of a photo. Telegram sends several, smallest first. */
export type TgPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

/** A file sent as a document, which is how uncompressed screenshots arrive. */
export type TgDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TgMessage = {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: TgUser;
  sender_chat?: TgChat;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  photo?: TgPhotoSize[];
  document?: TgDocument;
  /** Shared by the messages of one album. */
  media_group_id?: string;
  reply_to_message?: TgMessage;
  forum_topic_created?: unknown;
  new_chat_members?: TgUser[];
  left_chat_member?: TgUser;
  via_bot?: TgUser;
  /** Set on a forwarded message: who it first came from (a user, a group or a channel). */
  forward_origin?: { type: "user" | "hidden_user" | "chat" | "channel"; chat?: TgChat; sender_chat?: TgChat };
  /** A reply quoting a message from another chat (a channel post, usually). */
  external_reply?: { origin?: { type: string }; chat?: TgChat; text?: string; caption?: string };
  quote?: { text?: string };
};

export type TgChatMember = {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  user: TgUser;
  is_member?: boolean;
};

export type TgChatMemberUpdated = {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: TgChatMember;
  new_chat_member: TgChatMember;
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  chat_member?: TgChatMemberUpdated;
};

/** The update kinds the webhook asks Telegram for. */
export const ALLOWED_UPDATES = ["message", "edited_message", "chat_member"];

export type SendOptions = {
  /** Topic to post in. Leave out for General and private chats. */
  threadId?: number;
  /** Message to answer. Sent as a reply when it still exists. */
  replyTo?: number;
  /** "HTML" for the welcome; everything else is plain text. */
  parseMode?: "HTML";
};

const API = "https://api.telegram.org";

function token(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

async function call<T>(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: T }> {
  const t = token();
  if (!t) return { ok: false };
  try {
    const res = await fetch(`${API}/bot${t}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T } | null;
    return { ok: Boolean(res.ok && json?.ok), result: json?.result };
  } catch {
    return { ok: false };
  }
}

/** Sends a message with link previews off. Returns the new message id, or null. */
export async function sendMessage(chatId: number, text: string, opts: SendOptions = {}): Promise<number | null> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  };
  if (opts.threadId) body.message_thread_id = opts.threadId;
  if (opts.replyTo) body.reply_parameters = { message_id: opts.replyTo, allow_sending_without_reply: true };
  if (opts.parseMode) body.parse_mode = opts.parseMode;
  const r = await call<{ message_id: number }>("sendMessage", body);
  return r.ok && r.result ? r.result.message_id : null;
}

/** Telegram's limit on a photo caption. */
export const CAPTION_MAX = 1024;

/**
 * Sends a photo (a public https URL or a file_id Telegram already holds) with
 * a plain-text caption. Returns the new message id and the photo's file_id,
 * so the next post can send the same picture without Telegram fetching it
 * again; null on any failure.
 */
export async function sendPhoto(
  chatId: number,
  photo: string,
  caption: string,
  opts: SendOptions = {},
): Promise<{ messageId: number; fileId: string | null } | null> {
  if (caption.length > CAPTION_MAX) return null;
  const body: Record<string, unknown> = { chat_id: chatId, photo, caption };
  if (opts.threadId) body.message_thread_id = opts.threadId;
  if (opts.replyTo) body.reply_parameters = { message_id: opts.replyTo, allow_sending_without_reply: true };
  if (opts.parseMode) body.parse_mode = opts.parseMode;
  const r = await call<{ message_id: number; photo?: TgPhotoSize[] }>("sendPhoto", body);
  if (!r.ok || !r.result) return null;
  const sizes = r.result.photo ?? [];
  return { messageId: r.result.message_id, fileId: sizes.length ? sizes[sizes.length - 1]!.file_id : null };
}

/** Deletes a message. Works only while the bot is an admin with Delete messages. */
export async function deleteMessage(chatId: number, messageId: number): Promise<boolean> {
  return (await call("deleteMessage", { chat_id: chatId, message_id: messageId })).ok;
}

/**
 * Removes someone from the group and keeps them out, deleting what they posted
 * there. Works only while the bot is an admin with Ban users. An admin can
 * lift it in the group's settings.
 */
export async function banMember(chatId: number, userId: number): Promise<boolean> {
  return (await call("banChatMember", { chat_id: chatId, user_id: userId, revoke_messages: true })).ok;
}

/** Lets someone the bot banned join the group again. Only lifts a ban; never removes a member. */
export async function unbanMember(chatId: number, userId: number): Promise<boolean> {
  return (await call("unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true })).ok;
}

/** The bot's own account, read once per server instance. */
export async function getMe(): Promise<TgUser | null> {
  const g = globalThis as { __gloamTgMe?: TgUser };
  if (g.__gloamTgMe) return g.__gloamTgMe;
  const r = await call<TgUser>("getMe", {});
  if (r.ok && r.result?.id) g.__gloamTgMe = r.result;
  return g.__gloamTgMe ?? null;
}

type TgFile = { file_id: string; file_size?: number; file_path?: string };

/** Where Telegram keeps a file, and its size when known. Null when it will not say. */
export async function getFile(fileId: string): Promise<{ path: string; size: number | null } | null> {
  const r = await call<TgFile>("getFile", { file_id: fileId });
  const path = r.ok ? r.result?.file_path : undefined;
  if (!path || !/^[\w./-]{1,200}$/.test(path) || path.includes("..")) return null;
  return { path, size: typeof r.result?.file_size === "number" ? r.result.file_size : null };
}

/**
 * Downloads a file from Telegram's file server, at most `maxBytes`. Null when
 * it is bigger, the download fails or there is no token. The URL carries the
 * token, so it is never logged.
 */
export async function downloadFile(path: string, maxBytes: number): Promise<Uint8Array | null> {
  const t = token();
  if (!t) return null;
  try {
    const res = await fetch(`${API}/file/bot${t}/${path}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body.cancel().catch(() => {});
      return null;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Re-registers the webhook at the URL Telegram already has, with the same
 * secret, asking for ALLOWED_UPDATES. Nothing pending is dropped.
 */
export async function refreshWebhook(secret: string): Promise<{ ok: boolean; url: string | null }> {
  const info = await call<{ url?: string }>("getWebhookInfo", {});
  const url = info.ok ? info.result?.url ?? null : null;
  if (!url) return { ok: false, url: null };
  const r = await call<boolean>("setWebhook", { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES });
  return { ok: r.ok, url };
}

/** How many people are in a chat right now, or null. */
export async function getChatMemberCount(chatId: number): Promise<number | null> {
  const r = await call<number>("getChatMemberCount", { chat_id: chatId });
  return r.ok && typeof r.result === "number" ? r.result : null;
}
