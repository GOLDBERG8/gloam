/**
 * Glim, the Gloam community helper on Telegram: what it does with each update
 * the webhook (app/api/telegram) hands it. Server only.
 *
 * It talks only in the Gloam group (TELEGRAM_GROUP_ID). Private messages get
 * no reply at all, with one exception: the owner (TELEGRAM_OWNER_IDS, else
 * TELEGRAM_OWNER_HANDLES), who can ask for the 24-hour report there. It never
 * starts a DM; the scheduled report goes only to a chat an owner opened.
 * Every other chat is ignored. In the group:
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
import { askModel, systemPrompt, userPrompt, wantsHelper, type AskInput, type ModelImage } from "./answer";
import { personaName } from "./persona";
import { buildReport } from "./report";
import {
  MAX_IMAGE_BYTES,
  SHORT_CAPTION_WORDS,
  TOPIC,
  cleanName,
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
  firstOfAlbum,
  handedOffLately,
  lockedCodeNear,
  logEscalation,
  logQuestion,
  markHandOff,
  markSeen,
  queueJoiners,
  remember,
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
  /** Who may DM the bot for reports. Ids win over handles when any are set. */
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

/** The owner or an admin: their warnings are not scams, and they never get code heads-ups or hand-offs. */
function isTrusted(u: TgUser, c: BotConfig): boolean {
  return isOwner(u, c) || c.adminIds.includes(u.id) || Boolean(u.username && c.admins.includes(u.username.toLowerCase()));
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

function ownerHelp(c: BotConfig): string {
  const daily = c.dailyReport ? "\nA report also arrives here every day at 21:00 WAT." : "";
  return (
    `Owner commands\n` +
    `/report - the last 24 hours in the group: members, activity, what ${c.persona} did, bug reports and what people asked\n` +
    `/help - this list\n` +
    `You can also just say "report" or "how was today".${daily}`
  );
}

const OWNER_HINT = "Send /report for the last 24 hours in the group.";

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
  return { reply: cleanReply(text, { handles }), sentinel: null };
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
  let asked = looksLikeQuestion(text);
  // no question mark, but asking for help, reporting a problem or getting Gloam wrong: a quick check decides
  if (
    !asked &&
    !tagged &&
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
  if (bareShot && !bug && msg.media_group_id && !(await firstOfAlbum(msg.media_group_id).catch(() => false))) return;

  const saved = bug ? await saveBug(msg, from, text, topicName(topic)) : false;
  if (!(await withinLimits(from.id))) return;

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

  const { reply: answer, sentinel } = await compose({
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

  const vague = !image && isVague(target ? `${targetText} ${text}` : text, c.persona);
  const fallback = fallbackKind({ vague, askerIsAdmin: isTrusted(asker, c), adminInvolved, handedOff });
  const reply = answer ?? (saved ? bugThanks(name) : tagged ? cantAnswer(c, askerName, topic, fallback) : null);
  if (!reply) return;
  const replyTo = target ? target.message_id : msg.message_id;
  const sent = await sendMessage(chatId, reply, { threadId, replyTo });
  if (!sent) return;
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

/**
 * The owner's private chat: reports only. /report or a plain "report" sends the
 * last 24 hours, /help lists the commands, anything else gets a one-line hint.
 * Everyone else gets no reply at all and costs no model call.
 */
async function onPrivate(msg: TgMessage, c: BotConfig): Promise<void> {
  const from = msg.from;
  if (!from || from.is_bot || !isOwner(from, c)) return;
  const chatId = msg.chat.id;
  await rememberOwnerChat(chatId, from.username).catch(() => {});
  const text = messageText(msg);
  if (!text) return;
  if (secretLeak(scanCodes(text).masked)) {
    const removed = await deleteMessage(chatId, msg.message_id);
    await sendMessage(chatId, leakWarning(firstName(from), removed));
    return;
  }
  if (!(await withinLimits(from.id))) return;
  const me = await getMe();
  const cmd = parseCommand(text, me?.username);
  if (cmd?.forOther) return;
  let reply = OWNER_HINT;
  if (cmd?.name === "help" || cmd?.name === "start") reply = ownerHelp(c);
  else if (cmd ? cmd.name === "report" : wantsReport(text)) reply = await buildReport(c.groupId, c.persona);
  await sendMessage(chatId, reply);
}

// ---------------------------------------------------------------- entry

/** Handles one authenticated update. Never throws for a bad update; network failures are swallowed. */
export async function handleUpdate(update: TgUpdate, c: BotConfig = botConfig()): Promise<void> {
  const seen = await markSeen(update.update_id).catch(() => ({ fresh: true, welcomePending: false }));
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
