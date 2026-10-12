/**
 * Glim, the Gloam community helper on Telegram: what it does with each update
 * the webhook (app/api/telegram) hands it. Server only.
 *
 * It talks in the Gloam group (TELEGRAM_GROUP_ID) and, in private, only with
 * the team: the owner (TELEGRAM_OWNER_IDS, else TELEGRAM_OWNER_HANDLES) and the
 * admins (TELEGRAM_ADMIN_IDS or TELEGRAM_ADMIN_HANDLES). Anyone else's private
 * message gets no reply and costs no model call. With the team it chats: it
 * answers in its own voice from the product facts and the group's live
 * numbers, drafts posts and replies, and remembers the last few exchanges for
 * a few hours. The owner also gets /report. A private chat is chat only: it
 * never posts in the group or acts on anything from there. It never starts a
 * DM; the scheduled report goes only to a chat an owner opened. Every other
 * chat is ignored. In the group:
 *  - a seed phrase or private key gets deleted (when the bot is admin) and a
 *    warning to move funds now; an obvious scam gets deleted and a short "admins
 *    never DM first" note
 *  - it answers when tagged or replied to, and every question, in any topic
 *    but Announcements, plus bug reports in Testers and Feedback, which it
 *    also saves for the admin dashboard
 *  - tagged on someone else's message, it answers that message, as a reply to
 *    its author
 *  - it reads pictures: a screenshot with a question, one it is tagged on,
 *    and bare screenshots in Help, Testers and Feedback (staying quiet when
 *    one needs no reply). One that shows a secret is deleted like a pasted one
 *  - payment codes and claim links are fine on testnet, so they stay; the
 *    person gets one friendly heads-up a day about sending them privately on
 *    mainnet. Gloam addresses and payment requests never get one
 *  - new members get one batched welcome at most every ten minutes
 *  - /help and /start give a short guide, /bug saves a report
 *  - it counts messages, joins, leaves and its own work for the report
 * Answers are rate limited per person and overall, and pictures to about 20
 * an hour; past a limit it stays quiet. It solves what it can and hands a
 * person to an admin only when it has to, at most once per conversation.
 */
import {
  askModel,
  askTeamChat,
  systemPrompt,
  teamSystemPrompt,
  userPrompt,
  wantsHelper,
  type AskInput,
  type ChatTurn,
  type ModelImage,
  type ModelMiss,
} from "./answer";
import { personaName } from "./persona";
import { buildReport, teamContext } from "./report";
import {
  MAX_IMAGE_BYTES,
  SHORT_CAPTION_WORDS,
  TOPIC,
  chainFix,
  chainMismatch,
  cleanName,
  isShare,
  trimReply,
  cleanReply,
  explicitReply,
  handsToAdmin,
  hasBearerCode,
  imageRef,
  isVague,
  looksLikeBugReport,
  looksLikeQuestion,
  mayNeedHelp,
  memoryText,
  mentionsBot,
  messageText,
  namesPersona,
  parseCommand,
  readSentinel,
  scamReason,
  scanCodes,
  secretLeak,
  sharesPhrase,
  sniffImage,
  tagsSomeone,
  teamMemoryText,
  topicName,
  topicOf,
  wantsReport,
  welcomeHtml,
  withoutTag,
  wordCount,
  type CodeScan,
  type Command,
  type ImageRef,
  type Joiner,
  type Sentinel,
} from "./rules";
import {
  bump,
  codeTipDue,
  countMembers,
  countMessage,
  dmHistory,
  firstOfAlbum,
  handedOffLately,
  lockedCodeNear,
  logEscalation,
  logQuestion,
  logUnanswered,
  markHandOff,
  markSeen,
  queueJoiners,
  remember,
  rememberDm,
  rememberOwnerChat,
  saveBugReport,
  takeImageSlot,
  takeWelcomeBatch,
  threadThenRemember,
  watchLockedCode,
  type Counter,
} from "./store";
import {
  deleteMessage,
  downloadFile,
  getFile,
  getMe,
  sendMessage,
  type TgChatMemberUpdated,
  type TgMessage,
  type TgUpdate,
  type TgUser,
} from "./telegram";
import { hitRateLimit } from "@/lib/mcpRemote/rateLimit";

/** t.me/gloamhq. TELEGRAM_GROUP_ID overrides it. */
const GLOAM_GROUP_ID = -1004464028206;
/** Answers per person per minute, and for everyone together. */
const USER_PER_MIN = 4;
const GLOBAL_PER_MIN = 40;
/** Quick "should I answer this?" checks on messages that are not phrased as questions. */
const CLASSIFY_PER_MIN = 12;
/** Scam warnings per topic per minute, so a raid does not turn into a wall of warnings. */
const WARN_PER_MIN = 2;
/** Bug reports saved per person per minute. */
const BUGS_PER_MIN = 6;
/** Topics where a screenshot with no caption (or a few words) still gets a look. */
const SCREENSHOT_TOPICS = new Set<number>([TOPIC.help, TOPIC.testers, TOPIC.feedback]);
/** Phrase-looking messages longer than this are not checked against a locked code. */
const PHRASE_MAX_CHARS = 120;

export type BotConfig = {
  groupId: number;
  persona: string;
  testingOpen: boolean;
  /** Admin handles, lower case, without "@". */
  admins: string[];
  /** TELEGRAM_ADMIN_IDS: admins by numeric id, which survives a handle change. */
  adminIds: number[];
  /** Who gets /report in a DM. Ids win over handles when any are set. */
  owners: { ids: number[]; handles: string[] };
  /** TELEGRAM_DAILY_REPORT: the cron sends the report at 21:00 WAT. */
  dailyReport: boolean;
};

/** "@a, b" into ["a", "b"]: lower case, valid handles only. */
function handles(raw: string): string[] {
  return raw
    .split(",")
    .map((h) => h.trim().replace(/^@/, "").toLowerCase())
    .filter((h) => /^[a-z0-9_]{3,32}$/.test(h));
}

/** Numeric Telegram ids from a comma-separated env value (ids never change, handles can). */
function ids(raw: string | undefined): number[] {
  return (raw ?? "")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

export function botConfig(): BotConfig {
  const group = Number(process.env.TELEGRAM_GROUP_ID?.trim());
  return {
    groupId: Number.isSafeInteger(group) && group !== 0 ? group : GLOAM_GROUP_ID,
    persona: personaName(),
    testingOpen: /^(1|true|yes|on)$/i.test(process.env.GLOAM_TESTING_OPEN?.trim() ?? ""),
    admins: handles(process.env.TELEGRAM_ADMIN_HANDLES ?? ""),
    adminIds: ids(process.env.TELEGRAM_ADMIN_IDS),
    owners: {
      ids: ids(process.env.TELEGRAM_OWNER_IDS),
      handles: handles(process.env.TELEGRAM_OWNER_HANDLES ?? "dukedotsol"),
    },
    dailyReport: /^(1|true|yes|on)$/i.test(process.env.TELEGRAM_DAILY_REPORT?.trim() ?? ""),
  };
}

/** The owner, by id when TELEGRAM_OWNER_IDS is set (handles can change), else by handle. */
export function isOwner(u: { id: number; username?: string }, c: BotConfig): boolean {
  if (c.owners.ids.length) return c.owners.ids.includes(u.id);
  return Boolean(u.username && c.owners.handles.includes(u.username.toLowerCase()));
}

/** An admin, by TELEGRAM_ADMIN_IDS or TELEGRAM_ADMIN_HANDLES. */
export function isAdmin(u: { id: number; username?: string }, c: BotConfig): boolean {
  return c.adminIds.includes(u.id) || Boolean(u.username && c.admins.includes(u.username.toLowerCase()));
}

/** The owner or an admin: their warnings are not scams, they never get code heads-ups or hand-offs, and they can chat in a DM. */
function isTrusted(u: TgUser, c: BotConfig): boolean {
  return isOwner(u, c) || isAdmin(u, c);
}

// ---------------------------------------------------------------- copy

function groupGuide(c: BotConfig): string {
  const testing = c.testingOpen
    ? "Testers, your guide is pinned in the Testers topic."
    : "Testing directions land in the Testers topic soon.";
  return (
    `Hi, I'm ${c.persona}, Gloam's community helper bot. Tag me or reply to me with a question, or just ask in Help. ` +
    `Ideas and bugs go in Feedback, or type /bug and what happened. ${testing} ` +
    `Docs live at gloam.trade/docs, news at @gloamtrade, and anything private goes to hello@gloam.trade. Admins never DM first.`
  );
}

const CHAT_HELP =
  "Or just talk to me here, no command needed. Ask what people asked today, whether there are bugs, how to answer a member, " +
  "or for a draft announcement. Screenshots work too. I remember the last few messages for a few hours.";

function ownerHelp(c: BotConfig): string {
  const daily = c.dailyReport ? "\nA report also arrives here every day at 21:00 WAT." : "";
  return (
    `Owner commands\n` +
    `/report - the last 24 hours in the group: members, activity, what ${c.persona} did, bug reports and what people asked\n` +
    `/help - this list\n` +
    `You can also just say "report" or "how was today".\n\n${CHAT_HELP}${daily}`
  );
}

function adminHelp(name: string): string {
  return (
    `Hi ${name}. Just talk to me here, no command needed. Ask what people asked today, whether there are bugs, ` +
    `how to answer a member, or for a draft announcement. Screenshots work too. I remember the last few messages for a few hours. ` +
    `I can only chat from here: I won't post in the group or do anything else.\n/help - this note`
  );
}

const ADMIN_REPORT =
  'The full report goes to Boss Duke, but ask me in words and I\'ll tell you what I have, like "what did people ask today?" or "any bugs?"';

/** What a team member hears when the model gave no reply. */
function chatMiss(miss: ModelMiss, owner: boolean): string {
  const report = owner ? " /report still works." : "";
  if (miss === "off") return `Chatting is switched off for me right now.${report}`;
  if (miss === "cap") return `That's all the chatting I can do today, the daily limit is used up. It resets at midnight UTC.${report}`;
  return `My light flickered and I couldn't answer that. Try again in a minute.${report}`;
}

const CHAT_REFUSED =
  "I wrote something I'm not allowed to send (a link, handle, address or detail off my list), so I binned it. Try asking another way.";

function bugThanks(name: string): string {
  return `Thanks ${name}, saved for the team, and I'll make sure Boss Duke sees it. An admin will take a look. Steps, a screenshot or a transaction link make you everyone's favourite tester.`;
}

function bugNotSaved(name: string): string {
  return `Thanks ${name}. I couldn't save that just now, so please post it in the Feedback topic or email hello@gloam.trade, and an admin will take a look.`;
}

/** What the fallback does when there is no answer: ask for more, or hand off (once). */
type Fallback = "clarify" | "unsure" | "admins_here" | "already" | "handoff";

function fallbackKind(o: { vague: boolean; askerIsAdmin: boolean; adminInvolved: boolean; handedOff: boolean }): Fallback {
  if (o.vague) return "clarify";
  if (o.askerIsAdmin) return "unsure";
  if (o.adminInvolved) return "admins_here";
  return o.handedOff ? "already" : "handoff";
}

function cantAnswer(c: BotConfig, name: string, topic: number, kind: Fallback): string {
  if (kind === "clarify") {
    return `Give me a bit more to go on, ${name}. What were you trying to do, and what did the screen say? The exact error text or a screenshot works best.`;
  }
  if (kind === "unsure") return `Not going to guess on that one, ${name}. The facts I have don't cover it.`;
  if (kind === "admins_here") {
    return `The admins are already on this thread, ${name}, so they'll see it. If it's a problem, the exact error text or a screenshot helps whoever picks it up.`;
  }
  if (kind === "already") {
    return `This one's already with the team from earlier, ${name}. If anything changed, send the exact error text or a screenshot and I'll take another look.`;
  }
  const cc = c.admins.length ? ` (${c.admins.map((h) => `@${h}`).join(" ")})` : "";
  if (topic === TOPIC.help) return `Not going to guess on that one, ${name}. I'll take it to Boss Duke, and an admin will follow up here${cc}.`;
  return `Not going to guess on that one, ${name}. I'll take it to Boss Duke. Drop it in the Help topic or email hello@gloam.trade, and an admin will follow up${cc}.`;
}

function codeTip(name: string): string {
  return (
    `Quick heads-up, ${name}: fine here, it's testnet play money. On mainnet a plain payment code or claim link works like cash, ` +
    `so whoever sees it can claim it. Send those privately, or pay the person's Gloam address instead so the payment is sealed to them.`
  );
}

function phraseTip(name: string): string {
  return (
    `Quick heads-up, ${name}: fine here, it's testnet play money. On mainnet, share the phrase for a locked code privately, ` +
    `never next to the code, because the code plus its phrase lets anyone claim it.`
  );
}

function leakWarning(name: string, removed: boolean): string {
  const first = removed
    ? `${name}, I removed your message because it looked like a seed phrase or private key.`
    : `${name}, that looks like a seed phrase or private key. Please delete it now.`;
  return `${first} Treat that wallet as exposed: move your funds to a new wallet now, and never share it again. Nobody from Gloam will ever ask for it.`;
}

function scamWarning(removed: boolean): string {
  const first = removed ? "Heads up, I removed a message that looked like a scam." : "Heads up, that message looks like a scam.";
  return `${first} Gloam admins never DM first and will never ask for your seed phrase, private key or funds. If someone messages you offering help, it's not us.`;
}

// ---------------------------------------------------------------- helpers

/** Someone may get an answer now: under the per-person limit and the overall one. */
async function withinLimits(userId: number): Promise<boolean> {
  if (!(await hitRateLimit(`tg:${userId}`, "tg-user", USER_PER_MIN)).allowed) return false;
  return (await hitRateLimit("tg:all", "tg-global", GLOBAL_PER_MIN)).allowed;
}

/** Counting never gets in the way of answering. */
function count(counter: Counter): Promise<void> {
  return bump(counter).catch(() => {});
}

function firstName(u: TgUser, c?: BotConfig): string {
  if (c && isOwner(u, c)) return "Boss Duke";
  return cleanName(u.first_name, u.username ? cleanName(u.username) : "friend");
}

/** A link to the message, for the bug list. */
function messageLink(msg: TgMessage): string | null {
  if (msg.chat.type === "private") return null;
  if (msg.chat.username) return `https://t.me/${msg.chat.username}/${msg.message_id}`;
  const internal = String(msg.chat.id).replace(/^-100/, "");
  return msg.chat.type === "supergroup" ? `https://t.me/c/${internal}/${msg.message_id}` : null;
}

async function saveBug(msg: TgMessage, from: TgUser, text: string, thread: string): Promise<boolean> {
  if (!(await hitRateLimit(`tg:${from.id}`, "tg-bug", BUGS_PER_MIN)).allowed) return false;
  try {
    await saveBugReport({
      userId: from.id,
      username: from.username ?? null,
      firstName: cleanName(from.first_name, ""),
      thread,
      text,
      link: messageLink(msg),
    });
    return true;
  } catch {
    return false;
  }
}

/** History, then this message added to it. A store outage just means no history. */
async function historyFor(chatId: number, topic: number, name: string, text: string) {
  const t = memoryText(text);
  return threadThenRemember(chatId, topic, t ? { n: name, t } : null).catch(() => []);
}

/** A member's message other than the asker's own, the bot's, a channel's or another bot's. */
function otherMembers(r: TgMessage, from: TgUser, me: TgUser): boolean {
  const a = r.from;
  return Boolean(a && !a.is_bot && a.id !== from.id && a.id !== me.id && !r.sender_chat);
}

/**
 * The picture as the model takes it, or null: past the hourly cap, too big,
 * not really an image, or Telegram would not hand it over.
 */
async function loadPicture(ref: ImageRef): Promise<ModelImage | null> {
  if (ref.size !== null && ref.size > MAX_IMAGE_BYTES) return null;
  if (!(await takeImageSlot())) return null;
  const file = await getFile(ref.fileId);
  if (!file || (file.size !== null && file.size > MAX_IMAGE_BYTES)) return null;
  const bytes = await downloadFile(file.path, MAX_IMAGE_BYTES);
  const mediaType = bytes ? sniffImage(bytes) : null;
  if (!bytes || !mediaType) return null;
  return { mediaType, data: Buffer.from(bytes).toString("base64") };
}

/**
 * One friendly heads-up a day per person who posts a bearer code or claim
 * link, or a locked code with its phrase nearby. Testnet play money, so
 * nothing is deleted. Admins test with codes all the time and get none.
 */
async function codeHeadsUp(msg: TgMessage, from: TgUser, codes: CodeScan, name: string, threadId: number | undefined): Promise<void> {
  const chatId = msg.chat.id;
  let tip: string | null = null;
  if (hasBearerCode(codes.kinds)) {
    tip = codeTip(name);
  } else if (codes.kinds.has("locked")) {
    if (sharesPhrase(codes.rest)) tip = phraseTip(name);
    else await watchLockedCode(chatId, from.id, msg.message_id).catch(() => {});
  } else if (codes.rest.length <= PHRASE_MAX_CHARS && sharesPhrase(codes.rest)) {
    // the phrase on its own, a few messages after the same person's locked code
    if (await lockedCodeNear(chatId, from.id, msg.message_id).catch(() => false)) tip = phraseTip(name);
  }
  if (!tip || !(await codeTipDue(from.id).catch(() => false))) return;
  await sendMessage(chatId, tip, { threadId, replyTo: msg.message_id });
}

type Compose = {
  c: BotConfig;
  me: TgUser;
  from: TgUser;
  input: Omit<AskInput, "persona">;
  image: ModelImage | null;
};

/** The model's answer after the reply rules (or null), and its signal about a picture. */
async function compose(x: Compose): Promise<{ reply: string | null; sentinel: Sentinel }> {
  const raw = await askModel(
    systemPrompt({ persona: x.c.persona, testingOpen: x.c.testingOpen, admins: x.c.admins }),
    userPrompt({ persona: x.c.persona, ...x.input }),
    x.image,
  );
  if (!raw) return { reply: null, sentinel: null };
  if (x.image) await count("images");
  const { sentinel, text } = readSentinel(raw);
  // the signals only mean something for a picture; [[SKIP]] wins when nobody asked, or when it is all there is
  if (x.image && sentinel === "secret") return { reply: null, sentinel };
  if (x.image && sentinel === "skip" && (x.input.picture?.mayIgnore || !text)) return { reply: null, sentinel };
  if (!text) return { reply: null, sentinel: null };
  const handles = [...x.c.admins, x.from.username, x.me.username].filter((h): h is string => Boolean(h));
  return { reply: cleanReply(trimReply(text), { handles }), sentinel: null };
}

// ---------------------------------------------------------------- welcomes

function joinerOf(u: TgUser): Joiner {
  return { id: u.id, first: u.first_name, ...(u.username ? { username: u.username } : {}) };
}

/** Posts the batched welcome in General when one is due. */
async function flushWelcome(c: BotConfig): Promise<void> {
  const batch = await takeWelcomeBatch().catch(() => null);
  if (!batch?.length) return;
  if (await sendMessage(c.groupId, welcomeHtml(batch, c.testingOpen), { parseMode: "HTML" })) await count("welcomes");
}

async function welcome(users: TgUser[], c: BotConfig): Promise<void> {
  const people = users.filter((u) => !u.is_bot);
  if (people.length === 0) return;
  await countMembers("joins", people.map((u) => u.id)).catch(() => {});
  await queueJoiners(people.map(joinerOf)).catch(() => 0);
  await flushWelcome(c);
}

const inside = (s: string, member?: boolean) =>
  s === "member" || s === "administrator" || s === "creator" || (s === "restricted" && member === true);

/** A chat_member update that means someone joined (or came back). */
function joined(u: TgChatMemberUpdated): boolean {
  return !inside(u.old_chat_member.status, u.old_chat_member.is_member) && inside(u.new_chat_member.status, u.new_chat_member.is_member);
}

/** A chat_member update that means someone left or was removed. */
function left(u: TgChatMemberUpdated): boolean {
  return inside(u.old_chat_member.status, u.old_chat_member.is_member) && !inside(u.new_chat_member.status, u.new_chat_member.is_member);
}

// ---------------------------------------------------------------- group

async function onCommand(cmd: Command, msg: TgMessage, from: TgUser, c: BotConfig, topic: number): Promise<void> {
  const chatId = msg.chat.id;
  const threadId = msg.is_topic_message ? msg.message_thread_id : undefined;
  const name = firstName(from, c);
  if (cmd.name !== "help" && cmd.name !== "start" && cmd.name !== "bug") return;
  if (!(await withinLimits(from.id))) return;
  if (cmd.name === "bug") {
    if (cmd.args.length < 3) {
      await sendMessage(chatId, "Tell me what happened after /bug, like: /bug The faucet button keeps spinning on Tempo.", { threadId, replyTo: msg.message_id });
      return;
    }
    const saved = await saveBug(msg, from, cmd.args, topicName(topic));
    const text = saved ? bugThanks(name) : bugNotSaved(name);
    await sendMessage(chatId, text, { threadId, replyTo: msg.message_id });
    return;
  }
  await sendMessage(chatId, groupGuide(c), { threadId, replyTo: msg.message_id });
}

async function onGroupMessage(msg: TgMessage, c: BotConfig): Promise<void> {
  const from = msg.from;
  // other bots, channels, anonymous admins and service messages are not people asking
  if (!from || from.is_bot || msg.sender_chat || msg.via_bot) return;
  const chatId = msg.chat.id;
  const topic = topicOf(msg);
  await countMessage(topic, from.id).catch(() => {});
  const ownPicture = imageRef(msg);
  const raw = messageText(msg);
  if (!raw && !ownPicture) return;
  // codes and links become labels ([Gloam address], [claim link]) for everything that reads the text
  const codes = scanCodes(raw);
  const text = codes.masked;
  const threadId = msg.is_topic_message ? msg.message_thread_id : undefined;
  const name = firstName(from, c);
  const trusted = isTrusted(from, c);

  if (secretLeak(text)) {
    const removed = await deleteMessage(chatId, msg.message_id);
    await count(removed ? "secrets" : "secretsMissed");
    await sendMessage(chatId, leakWarning(name, removed), { threadId, replyTo: removed ? undefined : msg.message_id });
    return;
  }
  if (!trusted && scamReason(text)) {
    const removed = await deleteMessage(chatId, msg.message_id);
    await count(removed ? "scams" : "scamsMissed");
    if ((await hitRateLimit(`tg:${chatId}:${topic}`, "tg-warn", WARN_PER_MIN)).allowed) {
      await sendMessage(chatId, scamWarning(removed), { threadId, replyTo: removed ? undefined : msg.message_id });
    }
    return;
  }
  if (topic === TOPIC.announcements) return;

  const me = await getMe();
  if (!me) return;
  const cmd = parseCommand(text, me.username);
  if (cmd) {
    if (!cmd.forOther) await onCommand(cmd, msg, from, c, topic);
    return;
  }
  if (!trusted) await codeHeadsUp(msg, from, codes, name, threadId);

  const history = await historyFor(chatId, topic, name, ownPicture ? `[picture]${text ? ` ${text}` : ""}` : text);
  const replied = explicitReply(msg);
  const toBot = replied?.from?.id === me.id;
  // a tag, a reply to Glim, or saying its name; questions get answered in every topic (not Announcements)
  const tagged = mentionsBot(msg, me) || toBot || namesPersona(text, c.persona);
  // tagged on another member's message: that message is the question, and the answer goes to its author
  const target = tagged && !toBot && replied && otherMembers(replied, from, me) ? replied : null;
  const targetText = target ? scanCodes(messageText(target)).masked : "";
  // a payment, claim link or address shared for others (the app's own share text included) needs no reply
  const share = isShare(text);
  let asked = !share && looksLikeQuestion(text);
  // no question mark, but asking for help, reporting a problem or getting Gloam wrong: a quick check decides
  if (
    !asked &&
    !tagged &&
    !share &&
    !ownPicture &&
    mayNeedHelp(text) &&
    (await hitRateLimit("tg:classify", "tg-classify", CLASSIFY_PER_MIN)).allowed &&
    (await wantsHelper(text))
  ) {
    asked = true;
  }
  const bug = (topic === TOPIC.testers || topic === TOPIC.feedback) && looksLikeBugReport(text);
  // a screenshot in Help, Testers or Feedback with no caption, or only a few words, gets a look
  const bareShot = Boolean(ownPicture) && !tagged && !asked && SCREENSHOT_TOPICS.has(topic) && wordCount(text) <= SHORT_CAPTION_WORDS;

  // the question being answered is logged once: the original when tagged on it, else this one
  const question = target ? (looksLikeQuestion(targetText) ? null : targetText) : asked ? text : null;
  const kept = question ? memoryText(question) : null;
  if (kept) await logQuestion(kept).catch(() => {});
  if (!tagged && !bug && !asked && !bareShot) return;
  // every handled album message marks the album, so a captioned first picture also covers the rest
  const albumFirst = msg.media_group_id ? await firstOfAlbum(msg.media_group_id).catch(() => true) : true;
  if (bareShot && !bug && !albumFirst) return;

  const saved = bug ? await saveBug(msg, from, text, topicName(topic)) : false;
  // asked or tagged and not answered: kept for the team (a saved bug report is answered by being saved,
  // and a tag with nothing to go on, like "haha thanks" to Glim, is not a question)
  const missed = async (why: "limit" | "no_answer") => {
    if (saved || !(tagged || asked)) return;
    if (!asked && !ownPicture && isVague(target ? `${targetText} ${text}` : text, c.persona)) return;
    const t = memoryText(target ? targetText || text : text) ?? (ownPicture ? "[screenshot]" : null);
    if (!t) return;
    const who = target?.from ?? from;
    await logUnanswered({
      at: Date.now(),
      name: target ? firstName(who, c) : name,
      topic: topicName(topic),
      text: t.slice(0, 200),
      link: messageLink(target ?? msg),
      why,
    }).catch(() => {});
  };
  if (!(await withinLimits(from.id))) return missed("limit");

  // the picture: this message's own, else the one on the message it was tagged on
  const pictureMsg = ownPicture ? msg : tagged && !toBot && replied && imageRef(replied) ? replied : null;
  const pictureRef = ownPicture ?? (pictureMsg ? imageRef(pictureMsg) : null);
  const image = pictureRef ? await loadPicture(pictureRef) : null;
  // a bare screenshot it could not read gets no reply
  if (bareShot && !image && !saved) return;

  const asker = target?.from ?? from;
  const askerName = target ? firstName(asker, c) : name;
  const adminHandles = [...c.admins, ...c.owners.handles];
  const adminInvolved =
    trusted || tagsSomeone(msg, adminHandles, c.owners.ids) || Boolean(target && tagsSomeone(target, adminHandles, c.owners.ids));
  const handedOff = await handedOffLately(chatId, asker.id).catch(() => false);
  const repliedText = !target && replied ? scanCodes(messageText(replied)).masked : "";
  const inHistory = history.some((l) => l.t === repliedText);

  const { reply: modelAnswer, sentinel } = await compose({
    c,
    me,
    from,
    image,
    input: {
      asker: askerName,
      text: target ? targetText : text,
      topic: topicName(topic),
      repliedTo:
        repliedText && !inHistory && memoryText(repliedText)
          ? { name: toBot ? `${c.persona} (you)` : cleanName(replied?.from?.first_name), text: repliedText }
          : null,
      history,
      bug: saved,
      taggedBy: target ? { name, text: withoutTag(text, me.username) } : null,
      picture: pictureMsg ? { seen: Boolean(image), mayIgnore: bareShot, fromReply: pictureMsg !== msg && pictureMsg !== target } : null,
      adminInvolved,
      handedOff,
      storageDown,
    },
  });

  if (sentinel === "secret" && pictureMsg) {
    // a seed phrase or key in a screenshot: the same as one pasted as text
    const owner = pictureMsg.from ?? from;
    const removed = await deleteMessage(chatId, pictureMsg.message_id);
    await count(removed ? "secrets" : "secretsMissed");
    await sendMessage(chatId, leakWarning(firstName(owner, c), removed), { threadId, replyTo: removed ? undefined : pictureMsg.message_id });
    return;
  }
  if (sentinel === "skip") return;

  // a pasted wrong-network error has one fix, so it never waits on the model or the team
  const mismatch = modelAnswer ? null : chainMismatch([targetText, text, repliedText].filter(Boolean).join(" "));
  const answer = modelAnswer ?? (mismatch ? chainFix(askerName, mismatch) : null);
  const vague = !image && isVague(target ? `${targetText} ${text}` : text, c.persona);
  const fallback = fallbackKind({ vague, askerIsAdmin: isTrusted(asker, c), adminInvolved, handedOff });
  const reply = answer ?? (saved ? bugThanks(name) : tagged ? cantAnswer(c, askerName, topic, fallback) : null);
  if (!reply) return missed("no_answer");
  const replyTo = target ? target.message_id : msg.message_id;
  const sent = await sendMessage(chatId, reply, { threadId, replyTo });
  if (!sent) return missed("no_answer");
  // "not going to guess" with no hand-off (an admin asked, or admins are on it): still a question nobody answered
  if (!answer && (fallback === "unsure" || fallback === "admins_here")) await missed("no_answer");
  await remember(chatId, topic, { n: c.persona, t: reply.slice(0, 400), b: 1 }).catch(() => {});
  if (answer) await count("answered");
  // handed to a person: the hand-off fallback, or an answer that says an admin will follow up (bug thanks aside).
  // Once per person per conversation, and never when an admin asked or is already on it.
  const handsOff = !saved && (answer ? handsToAdmin(answer) : fallback === "handoff");
  if (handsOff && !handedOff && !adminInvolved) {
    await markHandOff(chatId, asker.id).catch(() => {});
    await logEscalation({
      at: Date.now(),
      name: askerName,
      topic: topicName(topic),
      text: (memoryText(target ? targetText || text : text) ?? "").slice(0, 200),
      link: messageLink(target ?? msg),
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------- private chats

/** Longest reply in a private chat, in characters (Telegram's limit is 4096). */
const DM_MAX_REPLY = 3000;
/** What a private chat keeps of each message: the person's, and the helper's reply. */
const DM_KEEP_ASKED = 800;
const DM_KEEP_REPLY = 1500;

/** Every key and token this deployment holds (public NEXT_PUBLIC_ values aside), so a reply can never carry one, even by accident. */
function deploymentSecrets(): string[] {
  return Object.entries(process.env)
    .filter(([k, v]) => /KEY|TOKEN|SECRET|PASSWORD|PRIVATE|PEPPER/i.test(k) && !k.startsWith("NEXT_PUBLIC_") && typeof v === "string" && v.trim().length >= 8)
    .map(([, v]) => v!.trim());
}

/**
 * A chat message from the owner or an admin: the reply in the helper's voice,
 * from the facts and the group's live numbers, with the last few exchanges.
 * Nothing it says can reach the group; it only ever answers this chat.
 */
async function chatWithTeam(msg: TgMessage, from: TgUser, c: BotConfig, owner: boolean, text: string, picture: ImageRef | null): Promise<void> {
  const chatId = msg.chat.id;
  const name = firstName(from, c);
  const who = owner ? "Boss Duke, the founder and owner of Gloam" : `${name}, one of the Gloam group's admins (not the owner)`;
  const [history, context, image] = await Promise.all([
    dmHistory(from.id).catch(() => []),
    teamContext(c.groupId, c.persona, who).catch(
      () => `TEAM CONTEXT\nYou are talking with ${who}.\nThe group's numbers and records could not be read just now, so you have none to give. Say so if asked.`,
    ),
    picture ? loadPicture(picture) : Promise.resolve(null),
  ]);
  const said = picture
    ? image
      ? text || "(a picture, no caption)"
      : `(sent a picture you could not open)${text ? ` ${text}` : ""}`
    : text;
  const turns: ChatTurn[] = [
    ...history.map((l): ChatTurn => ({ role: l.b ? "assistant" : "user", text: l.t })),
    { role: "user", text: said },
  ];
  const r = await askTeamChat(teamSystemPrompt({ persona: c.persona, testingOpen: c.testingOpen, admins: c.admins }), context, turns, image);
  if (!("text" in r)) {
    await sendMessage(chatId, chatMiss(r.miss, owner));
    return;
  }
  const { sentinel, text: out } = readSentinel(r.text);
  if (image && sentinel === "secret") {
    const removed = await deleteMessage(chatId, msg.message_id);
    await sendMessage(chatId, leakWarning(firstName(from), removed));
    return;
  }
  const me = await getMe();
  const handles = [...c.admins, ...c.owners.handles, from.username, me?.username].filter((h): h is string => Boolean(h));
  const reply = out ? cleanReply(out, { handles, maxChars: DM_MAX_REPLY, team: true, secrets: deploymentSecrets() }) : null;
  if (!reply) {
    await sendMessage(chatId, CHAT_REFUSED);
    return;
  }
  if (!(await sendMessage(chatId, reply))) return;
  const asked = teamMemoryText(picture ? `[picture]${text ? ` ${text}` : ""}` : text, DM_KEEP_ASKED);
  const kept = teamMemoryText(reply, DM_KEEP_REPLY);
  if (asked && kept) await rememberDm(from.id, [{ n: name, t: asked }, { n: c.persona, t: kept, b: 1 }]).catch(() => {});
}

/**
 * A private chat. The owner and the admins can talk to the helper; everyone
 * else gets no reply at all and costs no model call. /help lists what it can
 * do, the owner's /report (or a plain "report") sends the last 24 hours, and
 * anything else is a chat. A pasted seed phrase or key is deleted with a
 * warning, as in the group.
 */
async function onPrivate(msg: TgMessage, c: BotConfig): Promise<void> {
  const from = msg.from;
  if (!from || from.is_bot) return;
  const owner = isOwner(from, c);
  if (!owner && !isAdmin(from, c)) return;
  const chatId = msg.chat.id;
  if (owner) await rememberOwnerChat(chatId, from.username).catch(() => {});
  const raw = messageText(msg);
  const picture = imageRef(msg);
  if (!raw && !picture) return;
  // codes and links become labels, so the model never sees a bearer code
  const text = scanCodes(raw).masked;
  if (secretLeak(text)) {
    const removed = await deleteMessage(chatId, msg.message_id);
    await sendMessage(chatId, leakWarning(firstName(from), removed));
    return;
  }
  if (!(await withinLimits(from.id))) return;
  const me = await getMe();
  const cmd = parseCommand(text, me?.username);
  if (cmd?.forOther) return;
  if (cmd) {
    const name = firstName(from, c);
    let reply = owner ? ownerHelp(c) : adminHelp(name);
    if (cmd.name === "report") reply = owner ? await buildReport(c.groupId, c.persona) : ADMIN_REPORT;
    await sendMessage(chatId, reply);
    return;
  }
  if (owner && !picture && wantsReport(text)) {
    await sendMessage(chatId, await buildReport(c.groupId, c.persona));
    return;
  }
  await chatWithTeam(msg, from, c, owner, text, picture);
}

// ---------------------------------------------------------------- entry

/** Handles one authenticated update. Never throws for a bad update; network failures are swallowed. */
/** Whether this update found Gloam's storage failing: the helper's own first write is the probe. */
let storageDown = false;

export async function handleUpdate(update: TgUpdate, c: BotConfig = botConfig()): Promise<void> {
  storageDown = false;
  const seen = await markSeen(update.update_id).catch(() => {
    storageDown = true;
    return { fresh: true, welcomePending: false };
  });
  if (!seen.fresh) return;

  if (update.chat_member) {
    const u = update.chat_member;
    if (u.chat.id !== c.groupId) return;
    if (joined(u)) await welcome([u.new_chat_member.user], c);
    else if (left(u) && !u.new_chat_member.user.is_bot) await countMembers("leaves", [u.new_chat_member.user.id]).catch(() => {});
    return;
  }

  const msg = update.message;
  if (!msg) return;
  if (msg.chat.type === "private") return onPrivate(msg, c);
  if (msg.chat.id !== c.groupId) return;
  if (msg.new_chat_members?.length) return welcome(msg.new_chat_members, c);
  if (msg.left_chat_member) {
    if (!msg.left_chat_member.is_bot) await countMembers("leaves", [msg.left_chat_member.id]).catch(() => {});
    return;
  }
  if (seen.welcomePending) await flushWelcome(c);
  await onGroupMessage(msg, c);
}
