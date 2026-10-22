/**
 * Self-test: Glim's model routing through Raeto (lib/telegramBot/raetoRoute).
 *
 * Runs against a fake fetch, never Raeto itself. Covers: no key means no call;
 * an answer naming one of Glim's own models is used; any other model, an
 * error or a slow answer keeps the usual model; Raeto is sent only the
 * question text (no system prompt, names or history); pictures, commands,
 * codes, addresses and seed phrases are never sent; and only the group
 * answer path routes (never private chats, checks or the report).
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-raeto-route.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FAST_MODEL, ROUTE_TIMEOUT_MS, groupAnswerModel, routable } from "../src/lib/telegramBot/raetoRoute";

const USUAL = "claude-sonnet-5-5";
const KEY = "test-key";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

type Call = { url: string; init: RequestInit };
function fakeFetch(reply: (c: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const c = { url: String(url), init: init ?? {} };
    calls.push(c);
    return reply(c);
  }) as typeof fetch;
  return { calls, impl };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// keep the debug line out of the test output
console.debug = () => {};

await test("no key: no call, the usual model", async () => {
  const f = fakeFetch(() => json({ model: FAST_MODEL }));
  const saved = process.env.RAETO_API_KEY;
  delete process.env.RAETO_API_KEY;
  assert.equal(await groupAnswerModel({ text: "how do I add money?" }, USUAL, { fetchImpl: f.impl }), USUAL);
  if (saved !== undefined) process.env.RAETO_API_KEY = saved;
  assert.equal(f.calls.length, 0);
});

await test("Raeto's pick is used when it is one of Glim's models", async () => {
  const f = fakeFetch(() => json({ model: FAST_MODEL, tier: "fast" }));
  assert.equal(await groupAnswerModel({ text: "gm, how do I add money?" }, USUAL, { apiKey: KEY, fetchImpl: f.impl }), FAST_MODEL);
  const g = fakeFetch(() => json({ model: USUAL, tier: "top" }));
  assert.equal(await groupAnswerModel({ text: "why did my cash out fail with check_failed?" }, USUAL, { apiKey: KEY, fetchImpl: g.impl }), USUAL);
});

await test("Raeto is sent only the question text and the two model ids", async () => {
  const f = fakeFetch(() => json({ model: FAST_MODEL }));
  await groupAnswerModel(
    { text: "  how do I add money?  ", context: ["something Ada said earlier"] },
    USUAL,
    { apiKey: KEY, fetchImpl: f.impl },
  );
  assert.equal(f.calls.length, 1);
  const c = f.calls[0]!;
  assert.equal(c.url, "https://api.raeto.cc/v1/route");
  assert.equal((c.init.headers as Record<string, string>).authorization, `Bearer ${KEY}`);
  const body = JSON.parse(String(c.init.body));
  assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "models"]);
  assert.deepEqual(body.messages, [{ role: "user", content: "how do I add money?" }], "only the question, trimmed");
  assert.deepEqual(body.models, { fast: FAST_MODEL, mid: USUAL, top: USUAL });
  assert.ok(!String(c.init.body).includes("Ada"), "context is checked, never sent");
  assert.ok(!/system|You are/i.test(String(c.init.body)), "no system prompt");
});

await test("any other model, a bad reply or an error keeps the usual model", async () => {
  for (const reply of [
    () => json({ model: "gpt-4o-mini" }),
    () => json({ model: "claude-opus-5-5" }),
    () => json({ nope: true }),
    () => json({ error: "down" }, 500),
    () => Promise.reject(new Error("network")),
  ]) {
    const f = fakeFetch(reply);
    assert.equal(await groupAnswerModel({ text: "how do I add money?" }, USUAL, { apiKey: KEY, fetchImpl: f.impl }), USUAL);
    assert.equal(f.calls.length, 1);
  }
});

await test("a slow Raeto keeps the usual model within the timeout", async () => {
  const f = fakeFetch(
    (c) =>
      new Promise<Response>((_, reject) => {
        c.init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const t0 = Date.now();
  assert.equal(await groupAnswerModel({ text: "how do I add money?" }, USUAL, { apiKey: KEY, fetchImpl: f.impl }), USUAL);
  const took = Date.now() - t0;
  assert.ok(took >= ROUTE_TIMEOUT_MS - 50 && took < ROUTE_TIMEOUT_MS + 500, `gave up after ${took}ms`);
});

await test("pictures, commands, codes, addresses and secrets are never sent", async () => {
  const f = fakeFetch(() => json({ model: FAST_MODEL }));
  const never = [
    { text: "what does this error mean?", picture: true },
    { text: "/bug the app froze" },
    { text: "here is my code gloam1.eyJ2IjoxLCJ0IjoiZ2xvYW0tcHJpdmF0ZS1ub3RlIiwicyI6InBvc2VpZG9uIn0" },
    { text: "claim it: https://www.gloam.trade/claim?net=robinhood-mainnet#claim=gloam1=eyJ2IjoxLCJ0IjoiZ2xvYW0tcHJpdmF0ZS1ub3RlIn0" },
    { text: "is this right? [claim link]" },
    { text: "send to 0xDcD885F5c60b3aD49F6D58718696417314e8724d please" },
    { text: "my words are test test test test test test test test test test test junk is that ok" },
    { text: "what is this?", context: ["gloam1.eyJ2IjoxLCJ0IjoiZ2xvYW0tcHJpdmF0ZS1ub3RlIiwicyI6InBvc2VpZG9uIn0"] },
  ];
  for (const q of never) {
    assert.equal(routable(q), false, q.text);
    assert.equal(await groupAnswerModel(q, USUAL, { apiKey: KEY, fetchImpl: f.impl }), USUAL);
  }
  assert.equal(f.calls.length, 0);
  // a usual model that is already the fast one needs no routing
  assert.equal(await groupAnswerModel({ text: "how do I add money?" }, FAST_MODEL, { apiKey: KEY, fetchImpl: f.impl }), FAST_MODEL);
  assert.equal(f.calls.length, 0);
});

await test("only the group answer routes: never private chats, checks, moderation or the report", () => {
  const bot = readFileSync(new URL("../src/lib/telegramBot/bot.ts", import.meta.url), "utf8");
  const uses = bot.match(/groupAnswerModel\(/g) ?? [];
  assert.equal(uses.length, 1, "one call site");
  const composeAt = bot.indexOf("async function compose(");
  const callAt = bot.indexOf("groupAnswerModel(");
  const nextFn = bot.indexOf("\nasync function ", composeAt + 1);
  assert.ok(callAt > composeAt && callAt < nextFn, "inside compose(), the group answer");
  for (const f of ["answer.ts", "report.ts", "rules.ts"]) {
    assert.ok(!readFileSync(new URL(`../src/lib/telegramBot/${f}`, import.meta.url), "utf8").includes("raetoRoute"), `${f} does not route`);
  }
});

await test("the partner key is read from the environment, never written down", () => {
  const src = readFileSync(new URL("../src/lib/telegramBot/raetoRoute.ts", import.meta.url), "utf8");
  assert.ok(src.includes("process.env.RAETO_API_KEY"));
  assert.ok(!/sk-raeto-[A-Za-z0-9_-]{6,}/.test(src), "no key in the source");
});

console.log(`\nraeto route: ${passed} passed`);
