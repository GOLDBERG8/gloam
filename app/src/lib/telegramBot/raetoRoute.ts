/**
 * Model routing for Glim's group answers through Raeto (raeto.cc), a partner.
 *
 * route() is vendored from Raeto's SDK file https://api.raeto.cc/sdk/raeto-route.mjs
 * as reviewed on 2026-10-23 (sha256 706e4ab429bad42e54ef92c0f5c28f3b6d3102c331fd86e3296310b982b37560).
 * Only route() is kept, ported to TypeScript; nothing is loaded from their
 * URL at run time, so a change on their side cannot reach this server.
 *
 * Before a group answer, Raeto picks which of Glim's own models the question
 * needs: the fast one or the usual one. It is sent only the member's message
 * text (no name, no history, no topic, no system prompt) and the two model
 * ids; never our Anthropic key and never the reply. Its answer is used only
 * when it is exactly one of those ids, within ROUTE_TIMEOUT_MS; anything else
 * keeps the usual model. RAETO_API_KEY unset means no call at all.
 *
 * Only plain text questions in the group are routed. Never private chats,
 * the "should I answer?" check, moderation, the owner's report, pictures,
 * commands, or a message that carries a payment code, a claim link, a Gloam
 * address, a 0x address or what looks like a seed phrase or key.
 */
import { scanCodes, secretLeak } from "./rules";

const RAETO_BASE = "https://api.raeto.cc";
/** Glim answers fast; past this the usual model answers. */
export const ROUTE_TIMEOUT_MS = 800;
/** The cheapest model Glim uses (the same one as the "should I answer?" check). */
export const FAST_MODEL = "claude-haiku-5-5";
/** The most of the question Raeto is shown. */
const MAX_ROUTE_CHARS = 600;
/** Group replies are short; the same ceiling the answer itself uses. */
const ROUTE_MAX_TOKENS = 240;

type Tiers = { fast: string; mid: string; top: string };
type RouteMessage = { role: "user" | "assistant"; content: string };
type Decision = { model: string; tier?: string };

/** Raeto's answer ({ model, tier, ... }), or null if it could not answer in time. */
export async function route(
  request: { messages: RouteMessage[]; max_tokens?: number },
  o: { apiKey: string; models: Tiers; base?: string; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<Decision | null> {
  if (!o.apiKey || !Array.isArray(request.messages)) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? ROUTE_TIMEOUT_MS);
  try {
    const body = {
      messages: request.messages,
      ...(request.max_tokens ? { max_tokens: request.max_tokens } : {}),
      models: o.models,
    };
    const r = await (o.fetchImpl ?? globalThis.fetch)(`${(o.base ?? RAETO_BASE).replace(/\/+$/, "")}/v1/route`, {
      method: "POST",
      signal: ac.signal,
      headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { model?: unknown; tier?: unknown } | null;
    return j && typeof j.model === "string" ? { model: j.model, ...(typeof j.tier === "string" ? { tier: j.tier } : {}) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A group question as routing sees it. */
export type RouteQuestion = {
  /** The message being answered. */
  text: string;
  /** Other text the answer is built from (the replied-to message, a tagger's words): checked, never sent. */
  context?: string[];
  /** A picture comes with it. */
  picture?: boolean;
};

// the labels scanCodes puts in place of a code or link, in case the text was masked already
const CODE_LABEL = /\[(?:Gloam address|sealed payment|plain payment code|locked payment code|claim link|payment request link)[^\]]*\]/i;
const HEX_ADDRESS = /0x[0-9a-f]{8,}/i;

/** Whether this question may go to Raeto at all. */
export function routable(q: RouteQuestion): boolean {
  if (q.picture) return false;
  const text = q.text.trim();
  if (!text || text.startsWith("/")) return false;
  for (const t of [text, ...(q.context ?? [])]) {
    if (!t) continue;
    if (CODE_LABEL.test(t) || HEX_ADDRESS.test(t) || secretLeak(t) || scanCodes(t).kinds.size > 0) return false;
  }
  return true;
}

/**
 * The model for a group answer: the usual one, or the fast one when Raeto
 * says the question is simple. Never anything else, and never slower than
 * ROUTE_TIMEOUT_MS on top of the answer.
 */
export async function groupAnswerModel(
  q: RouteQuestion,
  usual: string,
  deps: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const apiKey = (deps.apiKey ?? process.env.RAETO_API_KEY)?.trim();
  if (!apiKey || usual === FAST_MODEL || !routable(q)) return usual;
  const decision = await route(
    { messages: [{ role: "user", content: q.text.trim().slice(0, MAX_ROUTE_CHARS) }], max_tokens: ROUTE_MAX_TOKENS },
    { apiKey, models: { fast: FAST_MODEL, mid: usual, top: usual }, fetchImpl: deps.fetchImpl },
  );
  const model = decision && (decision.model === FAST_MODEL || decision.model === usual) ? decision.model : usual;
  console.debug("telegram: raeto route", decision ? (decision.tier ?? "none") : "fallback", model);
  return model;
}
