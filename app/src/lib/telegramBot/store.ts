/**
 * What the Telegram helper keeps, in the partner program's store
 * (lib/partnersKv: Upstash Redis in production, in-process locally) under its
 * own prefix. Server only.
 *
 *  - seen updates, for a few minutes, so a retried webhook is handled once
 *  - the last few messages of each topic (first name and text, never anything
 *    that looks like a secret), for about six hours, so follow-ups make sense
 *  - new members waiting for the next batched welcome
 *  - bug reports, for the admin dashboard
 *  - counters for the owner's report: hourly buckets kept three days, the
 *    people active, joining and leaving each hour, escalations, questions it
 *    did not answer, and the question texts (48 hours, about 100 a day, never
 *    anything secret-shaped)
 *  - the owner's private chat, so a scheduled report knows where to go
 *  - each team member's private chat with the helper: the last ten exchanges,
 *    for three hours, so follow-ups make sense (never anything secret-shaped)
 *  - small flags with short lives: pictures read this hour (the cap), albums
 *    already looked at, who got today's code heads-up, a locked code waiting
 *    to see if its phrase follows, who was handed to an admin lately, and
 *    whether the $GLOAM card just went up in a topic
 *  - each member's last two minutes of messages, so a scam split over a few
 *    messages is read whole, and the group's admin list for five minutes
 *  - the buy alerts' place in the chain, the transactions already posted
 *    (three days), and any wait Telegram asked for
 */
import { randomUUID } from "crypto";
import { hashNumbers, jsonOf, kv } from "@/lib/partnersKv";
import type { ChatLine, Joiner } from "./rules";

const PREFIX = "gloam:tg:v1:";
const SEEN_TTL_SEC = 10 * 60;
const THREAD_KEEP = 12;
const THREAD_TTL_SEC = 6 * 60 * 60;
const PENDING = `${PREFIX}welcome:pending`;
const COOLDOWN = `${PREFIX}welcome:cooldown`;
/** At most one welcome this often. */
export const WELCOME_EVERY_SEC = 10 * 60;
const WELCOMED_TTL_SEC = 24 * 60 * 60;
const PENDING_MAX = 200;
const BUGS = `${PREFIX}bugs`;
const BUGS_MAX = 500;

const threadKey = (chatId: number, topic: number) => `${PREFIX}thread:${chatId}:${topic}`;

/**
 * Marks an update as seen. `fresh` is false for a repeat. Also says whether
 * new members are waiting for a welcome, in the same round trip.
 */
export async function markSeen(updateId: number): Promise<{ fresh: boolean; welcomePending: boolean }> {
  const [set, pending] = await kv([
    ["SET", `${PREFIX}seen:${updateId}`, "1", "EX", SEEN_TTL_SEC, "NX"],
    ["LRANGE", PENDING, 0, 0],
  ]);
  return { fresh: set !== null, welcomePending: Array.isArray(pending) && pending.length > 0 };
}

/**
 * The topic's recent lines, oldest first, then adds `line` to it. Reading
 * first keeps the new message out of its own history.
 */
export async function threadThenRemember(chatId: number, topic: number, line: ChatLine | null): Promise<ChatLine[]> {
  const key = threadKey(chatId, topic);
  const cmds: (string | number)[][] = [["LRANGE", key, 0, THREAD_KEEP - 1]];
  if (line) cmds.push(["LPUSH", key, JSON.stringify(line)], ["LTRIM", key, 0, THREAD_KEEP - 1], ["EXPIRE", key, THREAD_TTL_SEC]);
  const [raw] = await kv(cmds);
  const lines = (Array.isArray(raw) ? raw : []).map((r) => jsonOf<ChatLine>(r)).filter((l): l is ChatLine => Boolean(l?.n && l?.t));
  return lines.reverse();
}

/** The recent lines of several topics, oldest first in each, without adding anything. */
export async function recentThreads(chatId: number, topics: number[]): Promise<Map<number, ChatLine[]>> {
  const res = await kv(topics.map((t) => ["LRANGE", threadKey(chatId, t), 0, THREAD_KEEP - 1]));
  const out = new Map<number, ChatLine[]>();
  topics.forEach((t, i) => {
    const raw = res[i];
    const lines = (Array.isArray(raw) ? raw : []).map((r) => jsonOf<ChatLine>(r)).filter((l): l is ChatLine => Boolean(l?.n && l?.t));
    out.set(t, lines.reverse());
  });
  return out;
}

/** Adds one line (the helper's own reply) to a topic's history. */
export async function remember(chatId: number, topic: number, line: ChatLine): Promise<void> {
  const key = threadKey(chatId, topic);
  await kv([
    ["LPUSH", key, JSON.stringify(line)],
    ["LTRIM", key, 0, THREAD_KEEP - 1],
    ["EXPIRE", key, THREAD_TTL_SEC],
  ]);
}

/** Queues new members for the next welcome. Someone who joins twice in a day is welcomed once. */
export async function queueJoiners(joiners: Joiner[]): Promise<number> {
  if (joiners.length === 0) return 0;
  const claims = await kv(joiners.map((j) => ["SET", `${PREFIX}welcomed:${j.id}`, "1", "EX", WELCOMED_TTL_SEC, "NX"]));
  const fresh = joiners.filter((_, i) => claims[i] !== null);
  if (fresh.length === 0) return 0;
  await kv([
    ...fresh.map((j) => ["LPUSH", PENDING, JSON.stringify(j)]),
    ["LTRIM", PENDING, 0, PENDING_MAX - 1],
    ["EXPIRE", PENDING, WELCOMED_TTL_SEC],
  ]);
  return fresh.length;
}

/**
 * The members to welcome now, oldest first, or null while the last welcome is
 * under ten minutes old or nobody is waiting. Taking a batch starts the next
 * ten minutes.
 */
export async function takeWelcomeBatch(): Promise<Joiner[] | null> {
  const [slot] = await kv([["SET", COOLDOWN, "1", "EX", WELCOME_EVERY_SEC, "NX"]]);
  if (slot === null) return null;
  const [raw] = await kv([["LRANGE", PENDING, 0, -1]]);
  const items = Array.isArray(raw) ? raw : [];
  if (items.length === 0) {
    await kv([["DEL", COOLDOWN]]);
    return null;
  }
  // drop exactly what was read; anyone queued meanwhile sits at the head and waits for the next batch
  await kv([["LTRIM", PENDING, 0, -(items.length + 1)]]);
  return items
    .map((r) => jsonOf<Joiner>(r))
    .filter((j): j is Joiner => Boolean(j && typeof j.id === "number"))
    .reverse();
}

export type BugReport = {
  id: string;
  userId: number;
  username: string | null;
  firstName: string;
  /** Topic name, or "Direct message". */
  thread: string;
  text: string;
  /** Link to the message in the group, when it has one. */
  link: string | null;
  createdAt: number;
};

/** Saves a bug report for the admin dashboard. */
export async function saveBugReport(input: Omit<BugReport, "id" | "createdAt">): Promise<BugReport> {
  const report: BugReport = { ...input, id: randomUUID(), text: input.text.slice(0, 2_000), createdAt: Date.now() };
  await kv([
    ["LPUSH", BUGS, JSON.stringify(report)],
    ["LTRIM", BUGS, 0, BUGS_MAX - 1],
  ]);
  return report;
}

/** Bug reports, newest first. */
export async function listBugReports(limit = BUGS_MAX): Promise<BugReport[]> {
  const [raw] = await kv([["LRANGE", BUGS, 0, limit - 1]]);
  return (Array.isArray(raw) ? raw : []).map((r) => jsonOf<BugReport>(r)).filter((r): r is BugReport => r !== null);
}

// ---------------------------------------------------------------- owner report

const HOUR_MS = 3_600_000;
/** WAT (Africa/Lagos) is UTC+1 all year, no daylight saving. */
const WAT_OFFSET_MS = HOUR_MS;
const STATS_TTL_SEC = 3 * 24 * 60 * 60;
const QUESTIONS_TTL_SEC = 48 * 60 * 60;
const QUESTIONS_PER_DAY = 100;
const ESCALATIONS = `${PREFIX}escalations`;
const ESCALATIONS_MAX = 100;
const UNANSWERED = `${PREFIX}unanswered`;
const UNANSWERED_MAX = 50;
const ANSWERED = `${PREFIX}answered`;
const ANSWERED_MAX = 80;
const OWNER_CHATS = `${PREFIX}owner:chats`;

const hourOf = (now: number) => Math.floor(now / HOUR_MS);
const watDay = (now: number) => Math.floor((now + WAT_OFFSET_MS) / 86_400_000);
const statsKey = (hour: number) => `${PREFIX}stats:${hour}`;
const peopleKey = (kind: "active" | "joins" | "leaves", hour: number) => `${PREFIX}${kind}:${hour}`;
const questionsKey = (day: number) => `${PREFIX}questions:${day}`;

/** Things the helper does, counted per hour. */
export type Counter = "answered" | "images" | "welcomes" | "scams" | "scamsMissed" | "secrets" | "secretsMissed";

export async function bump(counter: Counter, now = Date.now()): Promise<void> {
  const key = statsKey(hourOf(now));
  await kv([
    ["HINCRBY", key, counter, 1],
    ["EXPIRE", key, STATS_TTL_SEC],
  ]);
}

/** One message seen in the group: the total, its topic, and who sent it. */
export async function countMessage(topic: number, userId: number, now = Date.now()): Promise<void> {
  const hour = hourOf(now);
  const key = statsKey(hour);
  const active = peopleKey("active", hour);
  await kv([
    ["HINCRBY", key, "msgs", 1],
    ["HINCRBY", key, `t${topic}`, 1],
    ["EXPIRE", key, STATS_TTL_SEC],
    ["SADD", active, userId],
    ["EXPIRE", active, STATS_TTL_SEC],
  ]);
}

/** People who joined or left. A set, so a join seen twice counts once. */
export async function countMembers(kind: "joins" | "leaves", userIds: number[], now = Date.now()): Promise<void> {
  if (userIds.length === 0) return;
  const key = peopleKey(kind, hourOf(now));
  await kv([
    ["SADD", key, ...userIds],
    ["EXPIRE", key, STATS_TTL_SEC],
  ]);
}

/** A question the helper handed to an admin, with a link so the owner can follow up. */
export type Escalation = { at: number; name: string; topic: string; text: string; link: string | null };

export async function logEscalation(e: Escalation): Promise<void> {
  const key = statsKey(hourOf(e.at));
  await kv([
    ["LPUSH", ESCALATIONS, JSON.stringify(e)],
    ["LTRIM", ESCALATIONS, 0, ESCALATIONS_MAX - 1],
    ["EXPIRE", ESCALATIONS, STATS_TTL_SEC],
    ["HINCRBY", key, "escalations", 1],
    ["EXPIRE", key, STATS_TTL_SEC],
  ]);
}

/**
 * A question the helper was asked (tagged, or a question in the open) but did
 * not answer: it was over its answer limits, or it had no answer it could post
 * (the model gave nothing usable, so it stayed quiet or said it would not
 * guess). Hand-offs are escalations, not this.
 */
export type Unanswered = Escalation & { why: "limit" | "no_answer" };

export async function logUnanswered(u: Unanswered): Promise<void> {
  await kv([
    ["LPUSH", UNANSWERED, JSON.stringify(u)],
    ["LTRIM", UNANSWERED, 0, UNANSWERED_MAX - 1],
    ["EXPIRE", UNANSWERED, STATS_TTL_SEC],
  ]);
}

/** A question the helper answered in the group, with the start of its reply, for the team's private chats. */
export type Answered = Escalation & { reply: string };

export async function logAnswered(a: Answered): Promise<void> {
  await kv([
    ["LPUSH", ANSWERED, JSON.stringify(a)],
    ["LTRIM", ANSWERED, 0, ANSWERED_MAX - 1],
    ["EXPIRE", ANSWERED, STATS_TTL_SEC],
  ]);
}

/** A group message by id, for a team member who links it in a private chat, and for edits. */
export type StoredMessage = { n: string; t: string; topic: number; at: number; uid: number };
const MSG_TTL_SEC = 3 * 24 * 60 * 60;
const msgKey = (id: number) => `${PREFIX}msg:${id}`;
const repliedKey = (id: number) => `${PREFIX}replied:${id}`;

export async function rememberMessage(id: number, m: StoredMessage): Promise<void> {
  await kv([["SET", msgKey(id), JSON.stringify(m), "EX", MSG_TTL_SEC]]);
}

export async function storedMessages(ids: number[]): Promise<(StoredMessage | null)[]> {
  if (ids.length === 0) return [];
  const res = await kv(ids.map((id) => ["GET", msgKey(id)]));
  return res.map((r) => jsonOf<StoredMessage>(r));
}

/** The helper answered this group message (so an edit or a team request does not answer it twice). */
export async function markReplied(id: number): Promise<void> {
  await kv([["SET", repliedKey(id), "1", "EX", MSG_TTL_SEC]]);
}

export async function wasReplied(id: number): Promise<boolean> {
  const [r] = await kv([["GET", repliedKey(id)]]);
  return r !== null && r !== undefined;
}

/** Keeps a question's text (already checked for secrets) for the report's summary. */
export async function logQuestion(text: string, now = Date.now()): Promise<void> {
  const key = questionsKey(watDay(now));
  await kv([
    ["LPUSH", key, JSON.stringify({ t: text.slice(0, 200), at: now })],
    ["LTRIM", key, 0, QUESTIONS_PER_DAY - 1],
    ["EXPIRE", key, QUESTIONS_TTL_SEC],
  ]);
}

export type Last24h = {
  /** Counter totals, plus "msgs" and "t<topic>" per topic. */
  counts: Record<string, number>;
  active: number;
  joins: number;
  leaves: number;
  escalations: Escalation[];
  /** Questions it did not answer, newest first. */
  unanswered: Unanswered[];
  /** Questions it answered, newest first. */
  answered: Answered[];
  /** Question texts, newest first. */
  questions: string[];
};

/** Everything counted in the last 24 hours, in one round trip. */
export async function readLast24h(now = Date.now()): Promise<Last24h> {
  const since = now - 24 * HOUR_MS;
  const hours = Array.from({ length: 24 }, (_, i) => hourOf(now) - i);
  const cmds: (string | number)[][] = hours.flatMap((h) => [
    ["HGETALL", statsKey(h)],
    ["SMEMBERS", peopleKey("active", h)],
    ["SMEMBERS", peopleKey("joins", h)],
    ["SMEMBERS", peopleKey("leaves", h)],
  ]);
  cmds.push(
    ["LRANGE", ESCALATIONS, 0, -1],
    ["LRANGE", questionsKey(watDay(now)), 0, -1],
    ["LRANGE", questionsKey(watDay(now) - 1), 0, -1],
    ["LRANGE", UNANSWERED, 0, -1],
    ["LRANGE", ANSWERED, 0, -1],
  );
  const res = await kv(cmds);

  const counts: Record<string, number> = {};
  const people = { active: new Set<string>(), joins: new Set<string>(), leaves: new Set<string>() };
  hours.forEach((_, i) => {
    for (const [k, v] of Object.entries(hashNumbers(res[i * 4]))) counts[k] = (counts[k] ?? 0) + v;
    (["active", "joins", "leaves"] as const).forEach((kind, j) => {
      const members = res[i * 4 + 1 + j];
      if (Array.isArray(members)) for (const m of members) people[kind].add(String(m));
    });
  });
  const tail = res.slice(hours.length * 4);
  const escalations = (Array.isArray(tail[0]) ? tail[0] : [])
    .map((r) => jsonOf<Escalation>(r))
    .filter((e): e is Escalation => Boolean(e && e.at > since));
  const questions = [...(Array.isArray(tail[1]) ? tail[1] : []), ...(Array.isArray(tail[2]) ? tail[2] : [])]
    .map((r) => jsonOf<{ t: string; at: number }>(r))
    .filter((q): q is { t: string; at: number } => Boolean(q && q.t && q.at > since))
    .map((q) => q.t);
  const unanswered = (Array.isArray(tail[3]) ? tail[3] : [])
    .map((r) => jsonOf<Unanswered>(r))
    .filter((u): u is Unanswered => Boolean(u && u.at > since && u.text));
  const answered = (Array.isArray(tail[4]) ? tail[4] : [])
    .map((r) => jsonOf<Answered>(r))
    .filter((a): a is Answered => Boolean(a && a.at > since && a.text));
  return { counts, active: people.active.size, joins: people.joins.size, leaves: people.leaves.size, escalations, unanswered, answered, questions };
}

/** Remembers the owner's private chat (its id is theirs) for scheduled reports. */
export async function rememberOwnerChat(chatId: number, username: string | undefined): Promise<void> {
  await kv([["HSET", OWNER_CHATS, String(chatId), (username ?? "").toLowerCase()]]);
}

/** Private chats owners have opened with the bot, with the handle each had then. */
export async function ownerChats(): Promise<{ chatId: number; username: string }[]> {
  const [raw] = await kv([["HGETALL", OWNER_CHATS]]);
  const out: { chatId: number; username: string }[] = [];
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const chatId = Number(raw[i]);
    if (Number.isSafeInteger(chatId) && chatId > 0) out.push({ chatId, username: String(raw[i + 1] ?? "") });
  }
  return out;
}

// ---------------------------------------------------------------- the team's private chats

/** Lines kept per private chat: ten exchanges, the person's message and the helper's reply. */
export const DM_KEEP = 20;
/** A private chat's memory ends this long after its last message. */
export const DM_TTL_SEC = 3 * 60 * 60;

const dmKey = (userId: number) => `${PREFIX}dm:${userId}`;

/** The private chat's recent lines, oldest first. Lines with `b` are the helper's. */
export async function dmHistory(userId: number): Promise<ChatLine[]> {
  const [raw] = await kv([["LRANGE", dmKey(userId), 0, DM_KEEP - 1]]);
  return (Array.isArray(raw) ? raw : [])
    .map((r) => jsonOf<ChatLine>(r))
    .filter((l): l is ChatLine => Boolean(l?.n && l?.t))
    .reverse();
}

/** Adds lines to a private chat's memory, oldest first, and starts its three hours again. */
export async function rememberDm(userId: number, lines: ChatLine[]): Promise<void> {
  if (lines.length === 0) return;
  const key = dmKey(userId);
  await kv([
    ...lines.map((l) => ["LPUSH", key, JSON.stringify(l)]),
    ["LTRIM", key, 0, DM_KEEP - 1],
    ["EXPIRE", key, DM_TTL_SEC],
  ]);
}

// ---------------------------------------------------------------- short-lived flags

/** Pictures read per clock hour, for everyone together. */
export const IMAGES_PER_HOUR = 20;
/** A phrase counts as shared with its locked code within this many messages of the chat, and this long. */
export const PHRASE_WITHIN_MSGS = 10;
const LOCKED_TTL_SEC = 30 * 60;
const CODE_TIP_TTL_SEC = 24 * 60 * 60;
const ALBUM_TTL_SEC = 10 * 60;

const lockedKey = (chatId: number, userId: number) => `${PREFIX}locked:${chatId}:${userId}`;
const handOffKey = (chatId: number, userId: number) => `${PREFIX}handoff:${chatId}:${userId}`;

/** Takes one of this hour's picture reads. False once the cap is reached, or when the store is down. */
/** This instance's own picture count for the hour, used while Redis is out. */
const memImages = new Map<number, number>();

export async function takeImageSlot(now = Date.now()): Promise<boolean> {
  const hour = hourOf(now);
  const key = `${PREFIX}images:${hour}`;
  try {
    const [n] = await kv([
      ["INCR", key],
      ["EXPIRE", key, 2 * 60 * 60],
    ]);
    return Number(n) <= IMAGES_PER_HOUR;
  } catch {
    // Redis down is no reason to go blind: count here instead, same cap
    const n = (memImages.get(hour) ?? 0) + 1;
    memImages.clear();
    memImages.set(hour, n);
    return n <= IMAGES_PER_HOUR;
  }
}

/** True for the first picture of an album, so an album of screenshots gets one look, not one each. */
/** Albums this instance has seen, used while Redis is out. */
const memAlbums = new Map<string, number>();

export async function firstOfAlbum(mediaGroupId: string, now = Date.now()): Promise<boolean> {
  try {
    const [r] = await kv([["SET", `${PREFIX}album:${mediaGroupId}`, "1", "EX", ALBUM_TTL_SEC, "NX"]]);
    return r !== null;
  } catch {
    // Redis down is no reason to skip a screenshot: remember the album here instead
    for (const [id, at] of memAlbums) if (now - at > ALBUM_TTL_SEC * 1000) memAlbums.delete(id);
    if (memAlbums.has(mediaGroupId)) return false;
    memAlbums.set(mediaGroupId, now);
    return true;
  }
}

/** One payment-code heads-up per person per day: true (and noted) when this one is due. */
export async function codeTipDue(userId: number): Promise<boolean> {
  const [r] = await kv([["SET", `${PREFIX}codetip:${userId}`, "1", "EX", CODE_TIP_TTL_SEC, "NX"]]);
  return r !== null;
}

/** Someone posted a locked code without its phrase: watch their next messages for the phrase. */
export async function watchLockedCode(chatId: number, userId: number, messageId: number): Promise<void> {
  await kv([["SET", lockedKey(chatId, userId), String(messageId), "EX", LOCKED_TTL_SEC]]);
}

/**
 * Whether this person posted a locked code within the last PHRASE_WITHIN_MSGS
 * messages of the chat. A hit ends the watch, so one code gets one heads-up.
 */
export async function lockedCodeNear(chatId: number, userId: number, messageId: number): Promise<boolean> {
  const key = lockedKey(chatId, userId);
  const [raw] = await kv([["GET", key]]);
  const at = Number(raw);
  if (!raw || !Number.isSafeInteger(at) || messageId - at > PHRASE_WITHIN_MSGS || messageId <= at) return false;
  await kv([["DEL", key]]);
  return true;
}

/** Whether the helper handed this person to an admin in this conversation (the thread memory's six hours). */
export async function handedOffLately(chatId: number, userId: number): Promise<boolean> {
  const [n] = await kv([["EXISTS", handOffKey(chatId, userId)]]);
  return Number(n) > 0;
}

export async function markHandOff(chatId: number, userId: number): Promise<void> {
  await kv([["SET", handOffKey(chatId, userId), "1", "EX", THREAD_TTL_SEC]]);
}

/** How long a posted $GLOAM card counts as "just above" in its topic. */
export const TOKEN_CARD_TTL_SEC = 10 * 60;
const tokenCardKey = (chatId: number, topic: number) => `${PREFIX}tokencard:${chatId}:${topic}`;

/** Whether the $GLOAM card went up in this topic in the last few minutes. */
export async function tokenCardLately(chatId: number, topic: number): Promise<boolean> {
  const [n] = await kv([["EXISTS", tokenCardKey(chatId, topic)]]);
  return Number(n) > 0;
}

export async function markTokenCard(chatId: number, topic: number): Promise<void> {
  await kv([["SET", tokenCardKey(chatId, topic), "1", "EX", TOKEN_CARD_TTL_SEC]]);
}

// ---------------------------------------------------------------- buy alerts

const BUYS = `${PREFIX}buys:`;

/**
 * One buy check at a time. The slot is held for `holdSec`, longer than a check
 * can run, so a slow check never overlaps the next; spaceBuysSlot then sets
 * when the next may start.
 */
export async function takeBuysSlot(holdSec: number): Promise<boolean> {
  const [r] = await kv([["SET", `${BUYS}lock`, "1", "EX", holdSec, "NX"]]);
  return r !== null;
}

/** A check is done: the next one may start `everySec` from now. */
export async function spaceBuysSlot(everySec: number): Promise<void> {
  await kv([["SET", `${BUYS}lock`, "1", "EX", everySec]]);
}

/** Telegram asked to slow down (a 429): no buy check until its wait is over. */
export async function pauseBuys(sec: number): Promise<void> {
  await kv([["SET", `${BUYS}pause`, "1", "EX", Math.max(1, Math.ceil(sec))]]);
}

export async function buysPaused(): Promise<boolean> {
  const [n] = await kv([["EXISTS", `${BUYS}pause`]]);
  return Number(n) > 0;
}

/** How long a posted buy's transaction stays claimed. */
const BUY_CLAIM_TTL_SEC = 3 * 24 * 60 * 60;

/** Claims a buy before it is posted, so no two checks ever post the same transaction. False when it was already claimed. */
export async function claimBuy(tx: string): Promise<boolean> {
  const [r] = await kv([["SET", `${BUYS}tx:${tx.toLowerCase()}`, "1", "EX", BUY_CLAIM_TTL_SEC, "NX"]]);
  return r !== null;
}

/** A claimed buy that did not go out: the next check may post it. */
export async function releaseBuy(tx: string): Promise<void> {
  await kv([["DEL", `${BUYS}tx:${tx.toLowerCase()}`]]);
}

/** The last block checked, or null the first time. */
export async function buysLastBlock(): Promise<number | null> {
  const [raw] = await kv([["GET", `${BUYS}last`]]);
  const n = Number(raw);
  return raw && Number.isSafeInteger(n) ? n : null;
}

export async function setBuysLastBlock(block: number): Promise<void> {
  await kv([["SET", `${BUYS}last`, String(block)]]);
}

// ---------------------------------------------------------------- a person's last words, and the group's admins

/** How far back one person's messages are read together, so a scam split over a few messages is still caught. */
export const RECENT_WORDS_SEC = 2 * 60;
const RECENT_WORDS_KEEP = 6;
const recentKey = (chatId: number, userId: number) => `${PREFIX}recent:${chatId}:${userId}`;

export type RecentWords = { id: number; t: string; at: number };

/** Adds a message to the person's last two minutes and returns the ones before it, oldest first. */
export async function recentThenKeep(chatId: number, userId: number, entry: RecentWords): Promise<RecentWords[]> {
  const key = recentKey(chatId, userId);
  const [raw] = await kv([
    ["LRANGE", key, 0, RECENT_WORDS_KEEP - 1],
    ["LPUSH", key, JSON.stringify(entry)],
    ["LTRIM", key, 0, RECENT_WORDS_KEEP - 1],
    ["EXPIRE", key, RECENT_WORDS_SEC],
  ]);
  return (Array.isArray(raw) ? raw : [])
    .map((r) => jsonOf<RecentWords>(r))
    .filter((w): w is RecentWords => Boolean(w?.t) && typeof w?.id === "number" && w.id !== entry.id && entry.at - w.at <= RECENT_WORDS_SEC * 1000)
    .reverse();
}

/** How long the group's admin list is kept before Telegram is asked again. */
const CHAT_ADMINS_TTL_SEC = 5 * 60;

export async function cachedChatAdmins(chatId: number): Promise<number[] | null> {
  const [raw] = await kv([["GET", `${PREFIX}admins:${chatId}`]]);
  const ids = jsonOf<number[]>(raw);
  return Array.isArray(ids) ? ids.filter((n) => Number.isSafeInteger(n)) : null;
}

export async function cacheChatAdmins(chatId: number, ids: number[]): Promise<void> {
  await kv([["SET", `${PREFIX}admins:${chatId}`, JSON.stringify(ids), "EX", CHAT_ADMINS_TTL_SEC]]);
}
