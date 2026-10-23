/**
 * People using Gloam (lib/people, lib/peopleStore, /api/people, lib/hll).
 *
 *  - an address becomes HMAC-SHA256(salt, lowercase address): the same for any
 *    letter case, different per salt, and never the address itself
 *  - the counts are HyperLogLogs: all time, per action and per UTC day, kept
 *    apart for mainnet and the testnets, near exact at this size
 *  - nothing stored, in the in-process store or a fake Redis behind the REST
 *    pipeline, holds an address or a lookup-able code, and what goes over the
 *    wire to Redis is the one-way code, never the address
 *  - the endpoint takes { w, env, a } and nothing else, is rate limited per
 *    minute and per hour, and counts nothing without a salt or in a demo build
 *  - the browser side: a connect goes out once a day, actions wait minutes and
 *    go out together, the demo sends nothing
 *  - the chain side: depositors join everyone, cash-out destinations get their
 *    own count, each block is added once
 *
 * Run from app/: ../mcp/node_modules/.bin/tsx scripts/selftest-people.mts
 */
import assert from "node:assert/strict";

const SALT = "test-salt-0123456789abcdef0123456789abcdef";
process.env.GLOAM_PARTNERS_STORE = "memory";
process.env.GLOAM_METRICS_SALT = SALT;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.NEXT_PUBLIC_GLOAM_DEMO;

// ---------------------------------------------------------------- a browser, enough for lib/people
const local = new Map<string, string>();
const session = new Map<string, string>();
const beacons: string[] = [];
const g = globalThis as Record<string, unknown>;
const loc = { hostname: "www.gloam.trade", href: "https://www.gloam.trade/app/vault", pathname: "/app/vault", search: "", hash: "" };
g.window = {
  localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) },
  sessionStorage: { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) },
  location: loc,
  history: { state: null, replaceState: () => {} },
};
Object.defineProperty(globalThis, "navigator", {
  value: {
    sendBeacon: (_u: string, b: Blob) => {
      void b.text().then((t) => beacons.push(t));
      return true;
    },
  },
  configurable: true,
});

// timers the browser side sets are caught here, so a test can see the wait and run it
type Timer = { fn: () => void; ms: number };
const timers: Timer[] = [];
const realSetTimeout = globalThis.setTimeout;
g.setTimeout = ((fn: () => void, ms: number) => {
  timers.push({ fn, ms });
  return timers.length as unknown as ReturnType<typeof setTimeout>;
}) as unknown as typeof setTimeout;
const flush = () => new Promise((r) => realSetTimeout(r, 10));

const { POST } = await import("../src/app/api/people/route");
const store = await import("../src/lib/peopleStore");
const { resetMemoryKv } = await import("../src/lib/partnersKv");
const people = await import("../src/lib/people");
const hll = await import("../src/lib/hll");

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** A made-up wallet: 0x and 40 hex digits from a seed, mixed case. */
function wallet(i: number): string {
  const hex = (BigInt(i + 1) * 0x9e3779b97f4a7c15n).toString(16).padStart(40, "a").slice(0, 40);
  return `0x${hex.slice(0, 20).toUpperCase()}${hex.slice(20)}`;
}

let ipN = 1;
const freshIp = () => `198.51.100.${ipN++ % 250}`;
const post = (body: unknown, ip = freshIp()) =>
  POST(
    new Request("https://www.gloam.trade/api/people", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "x-forwarded-for": ip },
    })
  );

/** Every key and value in the in-process store, as text. */
function memDump(): string {
  const m = (globalThis as { __gloamPartnersMem?: Map<string, { v: unknown }> }).__gloamPartnersMem ?? new Map();
  const out: string[] = [];
  for (const [k, e] of m) {
    out.push(k);
    const v = e.v;
    if (typeof v === "string") out.push(v);
    else if (v instanceof Map) out.push(...[...v.entries()].flat());
    else if (v instanceof Set || Array.isArray(v)) out.push(...[...v].map(String));
  }
  return out.join("\n").toLowerCase();
}

/** True when the text holds the address in any form, or its one-way code. */
function leaks(text: string, address: string): boolean {
  const a = address.toLowerCase();
  const code = store.personCode(SALT, address);
  return text.includes(a) || text.includes(a.slice(2)) || text.includes(code) || text.includes(code.slice(0, 16));
}

await test("an address becomes a one-way code: any letter case gives the same one, another salt a different one", () => {
  const w = wallet(1);
  const a = store.personCode(SALT, w);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(store.personCode(SALT, w.toLowerCase()), a);
  assert.equal(store.personCode(SALT, ` ${w.toUpperCase().replace("0X", "0x")} `), a);
  assert.notEqual(store.personCode(`${SALT}x`, w), a);
  assert.ok(!a.includes(w.toLowerCase().slice(2, 12)), "the code is not the address");
  // the leak check below catches both forms
  assert.ok(leaks(`x${a}x`, w) && leaks(w.toLowerCase(), w) && leaks(w.slice(2).toLowerCase(), w) && !leaks("hll1:1.2", w));
});

await test("the sketch is near exact at this size, and merging sketches counts each item once", () => {
  const a = new Map<number, number>();
  const b = new Map<number, number>();
  hll.addToHll(a, Array.from({ length: 300 }, (_, i) => `x${i}`));
  hll.addToHll(b, Array.from({ length: 300 }, (_, i) => `x${i + 150}`));
  const one = hll.countHll(a);
  const both = hll.countHll(hll.mergeHll([a, b]));
  assert.ok(Math.abs(one - 300) <= 3, `300 counted as ${one}`);
  assert.ok(Math.abs(both - 450) <= 4, `450 counted as ${both}`);
  assert.equal(hll.addToHll(a, ["x1"]), false, "an item already in changes nothing");
  assert.deepEqual(hll.decodeHll(hll.encodeHll(a)), a);
});

await test("the endpoint counts different wallets, all time, per action and today, mainnet and testnet apart", async () => {
  resetMemoryKv();
  const now = Date.now();
  for (let i = 0; i < 40; i++) assert.equal((await post({ w: wallet(i), env: "mainnet", a: ["connect"] })).status, 204);
  // the same wallets again, in another letter case: nobody new
  for (let i = 0; i < 40; i++) await post({ w: wallet(i).toLowerCase(), env: "mainnet", a: ["connect"] });
  for (let i = 0; i < 10; i++) await post({ w: wallet(i), env: "mainnet", a: ["claim", "send"] });
  for (let i = 100; i < 105; i++) await post({ w: wallet(i), env: "mainnet", a: ["claim"] });
  for (let i = 0; i < 7; i++) await post({ w: wallet(i), env: "testnet", a: ["connect", "deposit"] });

  const r = await store.readPeople(now);
  assert.equal(r.configured, true);
  assert.equal(r.mainnet.all, 45);
  assert.equal(r.mainnet.today, 45);
  assert.equal(r.mainnet.d7, 45);
  assert.equal(r.mainnet.d30, 45);
  assert.equal(r.mainnet.byAction.connect, 40);
  assert.equal(r.mainnet.byAction.claim, 15);
  assert.equal(r.mainnet.byAction.send, 10);
  assert.equal(r.mainnet.byAction.deposit, 0);
  assert.equal(r.mainnet.daily.at(-1)!.people, 45);
  assert.equal(r.mainnet.daily.length, store.PEOPLE_DAYS);
  assert.equal(r.testnet.all, 7, "testnets count apart");
  assert.equal(r.testnet.byAction.deposit, 7);
  assert.equal(r.testnet.byAction.claim, 0);
  assert.ok(r.since && Math.abs(r.since - now) < 60_000);
});

await test("nothing stored holds an address or a lookup-able code", async () => {
  const dump = memDump();
  assert.ok(dump.includes("gloam:people:v1:mainnet:all"), "the counters are there");
  for (const i of [0, 1, 9, 39, 100, 104]) assert.ok(!leaks(dump, wallet(i)), `wallet ${i} is not stored in any form`);
  // only registers: "hll1:" and slot.rank pairs
  const m = (globalThis as { __gloamPartnersMem?: Map<string, { v: unknown }> }).__gloamPartnersMem!;
  for (const [k, e] of m) {
    if (!k.startsWith("gloam:people:v1:") || k.endsWith(":since")) continue;
    assert.match(String(e.v), /^hll1:(\d+\.\d+(,\d+\.\d+)*)?$/, `${k} holds registers only`);
  }
});

await test("days: kept apart, 7 and 30 day windows add them up, a day's counter expires", async () => {
  resetMemoryKv();
  const day = 86_400_000;
  const now = Date.now();
  await store.addPerson(wallet(1), ["connect"], "mainnet", now - 10 * day);
  await store.addPerson(wallet(2), ["connect"], "mainnet", now - 3 * day);
  await store.addPerson(wallet(2), ["send"], "mainnet", now - day);
  await store.addPerson(wallet(3), ["connect"], "mainnet", now);
  const r = await store.readPeople(now);
  assert.equal(r.mainnet.all, 3);
  assert.equal(r.mainnet.today, 1);
  assert.equal(r.mainnet.d7, 2);
  assert.equal(r.mainnet.d30, 3);
  assert.deepEqual(r.mainnet.daily.slice(-4).map((d) => d.people), [1, 0, 1, 1]);
  const m = (globalThis as { __gloamPartnersMem?: Map<string, { exp: number | null }> }).__gloamPartnersMem!;
  const dayKey = [...m.keys()].find((k) => k.includes(":day:"))!;
  const left = (m.get(dayKey)!.exp ?? 0) - Date.now();
  assert.ok(left > 34 * day && left <= 35 * day, "a day's counter lives 35 days");
  assert.equal(m.get("gloam:people:v1:mainnet:all")!.exp, null, "all time stays");
});

await test("the endpoint takes { w, env, a } and nothing else", async () => {
  resetMemoryKv();
  const w = wallet(7);
  const bad: unknown[] = [
    { w, env: "mainnet", a: ["claim"], amount: "100" },
    { w, env: "mainnet", a: ["claim"], note: "rent" },
    { w, env: "mainnet", a: ["claim"], code: "gloam1.abc" },
    { w, env: "mainnet", a: ["send"], tx: "0x" + "ab".repeat(32) },
    { w, env: "mainnet", a: ["send"], demo: true },
    { w: "0x1234", env: "mainnet", a: ["connect"] },
    { w: "0x" + "0".repeat(40), env: "mainnet", a: ["connect"] },
    { w: "gloamr1abc", env: "mainnet", a: ["connect"] },
    { w, env: "devnet", a: ["connect"] },
    { w, a: ["connect"] },
    { w, env: "mainnet", a: [] },
    { w, env: "mainnet", a: "connect" },
    { w, env: "mainnet", a: ["page_view"] },
    { w, env: "mainnet", a: ["cashout_to"] },
    [w],
    "not json",
  ];
  for (const b of bad) assert.equal((await post(b)).status, 400, `refused: ${JSON.stringify(b)}`);
  assert.equal((await post(JSON.stringify({ w, env: "mainnet", a: ["connect"], pad: "x".repeat(400) }))).status, 413);
  assert.equal((await store.readPeople()).mainnet.all, 0, "none of them counted");
  assert.equal((await post({ w, env: "mainnet", a: ["claim", "claim", "send"] })).status, 204);
  const r = await store.readPeople();
  assert.equal(r.mainnet.byAction.claim, 1);
  assert.equal(r.mainnet.all, 1);
});

await test("rate limits: 20 a minute and 60 an hour from one address", async () => {
  resetMemoryKv();
  const ip = "203.0.113.77";
  const realNow = Date.now;
  const start = Math.floor(realNow() / 3_600_000) * 3_600_000 + 1_000;
  let t = start;
  Date.now = () => t;
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await post({ w: wallet(200 + i), env: "mainnet", a: ["connect"] }, ip)).status);
    assert.deepEqual(statuses.slice(0, 20), Array(20).fill(204));
    assert.equal(statuses[20], 429, "the 21st in a minute is refused");
    // the refused one still counts toward the hour (61 asked of 60): 20, then 20, then 19, then none
    let accepted = 20;
    for (let minute = 1; minute <= 3; minute++) {
      t = start + minute * 60_000;
      for (let i = 0; i < 20; i++) {
        const s = (await post({ w: wallet(300 + minute * 20 + i), env: "mainnet", a: ["connect"] }, ip)).status;
        if (s === 204) accepted++;
      }
    }
    assert.equal(accepted, 59, "60 asks in the hour, one of them refused by the minute");
    const r = await store.readPeople(t);
    assert.equal(r.mainnet.all, 59, "refused requests count nobody");
    t = start + 3_600_000 + 5_000;
    assert.equal((await post({ w: wallet(999), env: "mainnet", a: ["connect"] }, ip)).status, 204, "a new hour opens again");
  } finally {
    Date.now = realNow;
  }
});

await test("no salt, or a short one: nothing is counted and the endpoint still answers 204", async () => {
  resetMemoryKv();
  delete process.env.GLOAM_METRICS_SALT;
  delete process.env.GLOAM_RELAY_MEMO_SECRET;
  assert.equal((await post({ w: wallet(1), env: "mainnet", a: ["connect"] })).status, 204);
  process.env.GLOAM_METRICS_SALT = "too-short";
  assert.equal((await post({ w: wallet(1), env: "mainnet", a: ["connect"] })).status, 204);
  const r = await store.readPeople();
  assert.equal(r.configured, false);
  assert.equal(r.mainnet.all, 0);
  assert.equal(memDump().includes("gloam:people"), false, "not even a counter is made");
  process.env.GLOAM_METRICS_SALT = SALT;
});

await test("no salt but the relay's memo secret: counting runs on a key derived from it", async () => {
  resetMemoryKv();
  delete process.env.GLOAM_METRICS_SALT;
  const memo = "m".repeat(40);
  process.env.GLOAM_RELAY_MEMO_SECRET = memo;
  try {
    assert.equal(store.peopleConfigured(), true);
    assert.equal((await post({ w: wallet(1), env: "mainnet", a: ["connect"] })).status, 204);
    assert.equal((await store.readPeople()).mainnet.all, 1);
    const dump = memDump();
    assert.equal(dump.includes(memo), false, "the memo secret is never stored");
    assert.equal(dump.includes(store.personCode(memo, wallet(1))), false, "and isn't the key used");
    process.env.GLOAM_RELAY_MEMO_SECRET = "short";
    assert.equal(store.peopleConfigured(), false, "a short memo secret counts as unset");
  } finally {
    delete process.env.GLOAM_RELAY_MEMO_SECRET;
    process.env.GLOAM_METRICS_SALT = SALT;
  }
});

await test("a recording-demo build counts nothing", async () => {
  resetMemoryKv();
  process.env.NEXT_PUBLIC_GLOAM_DEMO = "1";
  try {
    assert.equal((await post({ w: wallet(1), env: "mainnet", a: ["connect", "claim"] })).status, 204);
    assert.equal((await store.readPeople()).mainnet.all, 0);
  } finally {
    delete process.env.NEXT_PUBLIC_GLOAM_DEMO;
  }
});

await test("browser: a connect goes out once a day with only the wallet, the side and the action", async () => {
  beacons.length = 0;
  local.clear();
  const w = wallet(11);
  people.countPerson("connect", w, false);
  people.countPerson("connect", w.toLowerCase(), false);
  people.countPerson("connect", w, true);
  people.countPerson("connect", "0xnotawallet", false);
  people.countPerson("connect", undefined, false);
  await flush();
  assert.equal(beacons.length, 2, "once per wallet per side");
  assert.deepEqual(JSON.parse(beacons[0]!), { w: w.toLowerCase(), env: "mainnet", a: ["connect"] });
  assert.deepEqual(JSON.parse(beacons[1]!), { w: w.toLowerCase(), env: "testnet", a: ["connect"] });
});

await test("browser: actions wait minutes and go out together, once a day each", async () => {
  beacons.length = 0;
  timers.length = 0;
  local.clear();
  const w = wallet(12);
  people.countPerson("claim", w, false);
  people.countPerson("send", w, false);
  people.countPerson("send", w, false);
  await flush();
  assert.equal(beacons.length, 0, "nothing goes out with the payment");
  assert.equal(timers.length, 1, "one wait");
  assert.ok(timers[0]!.ms >= 2 * 60_000 && timers[0]!.ms <= 10 * 60_000, `waits ${timers[0]!.ms}ms`);
  const held = JSON.parse(local.get("gloam.people.v1")!);
  assert.deepEqual(held.queue[0].a, ["claim", "send"]);
  // the wait ends
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60_000;
  try {
    timers[0]!.fn();
  } finally {
    Date.now = realNow;
  }
  await flush();
  assert.equal(beacons.length, 1);
  assert.deepEqual(JSON.parse(beacons[0]!), { w: w.toLowerCase(), env: "mainnet", a: ["claim", "send"] });
  assert.equal(JSON.parse(local.get("gloam.people.v1")!).queue.length, 0, "sent and gone");
  people.countPerson("send", w, false);
  await flush();
  assert.equal(timers.length, 1, "the same action the same day waits for nothing");
});

await test("browser: something left from an earlier visit goes out a little after the next one opens", async () => {
  beacons.length = 0;
  timers.length = 0;
  local.set(
    "gloam.people.v1",
    JSON.stringify({ day: new Date().toISOString().slice(0, 10), sent: [], queue: [{ w: wallet(13).toLowerCase(), env: "mainnet", a: ["cashout"], due: Date.now() - 60_000 }] })
  );
  people.resumePeopleCounts();
  assert.equal(timers.length, 1);
  assert.ok(timers[0]!.ms >= 5_000 && timers[0]!.ms <= 30_000, "not on load");
  timers[0]!.fn();
  await flush();
  assert.deepEqual(JSON.parse(beacons[0]!), { w: wallet(13).toLowerCase(), env: "mainnet", a: ["cashout"] });
});

await test("browser: the recording demo sends nothing", async () => {
  beacons.length = 0;
  timers.length = 0;
  local.clear();
  loc.hostname = "localhost";
  session.set("gloam_demo", "1");
  try {
    people.countPerson("connect", wallet(14), false);
    people.countPerson("claim", wallet(14), false);
    people.resumePeopleCounts();
    await flush();
    assert.equal(beacons.length, 0);
    assert.equal(timers.length, 0);
    assert.equal(local.get("gloam.people.v1"), undefined, "nothing is even kept");
  } finally {
    session.delete("gloam_demo");
    loc.hostname = "www.gloam.trade";
  }
});

await test("chain: depositors join everyone, cash-out destinations get their own count, each block once", async () => {
  resetMemoryKv();
  const now = Date.now();
  const ts = Math.floor(now / 1000) - 3_600;
  await store.addPerson(wallet(1), ["connect"], "mainnet", now);
  const vault = {
    network: "robinhood-mainnet",
    pool: "0x39e28cde55cab798874746ac52cb4b5cc99a0194",
    testnet: false,
    wallets: [
      { kind: "deposit" as const, wallet: wallet(1).toLowerCase(), ts, block: 10 },
      { kind: "deposit" as const, wallet: wallet(2).toLowerCase(), ts, block: 11 },
      { kind: "deposit" as const, wallet: wallet(2).toLowerCase(), ts, block: 12 },
      { kind: "cashout" as const, wallet: wallet(3).toLowerCase(), ts, block: 13 },
      { kind: "cashout" as const, wallet: wallet(4).toLowerCase(), ts, block: 14 },
      { kind: "cashout" as const, wallet: wallet(1).toLowerCase(), ts, block: 15 },
    ],
  };
  await store.addChainPeople([vault], now);
  let r = await store.readPeople(now);
  assert.equal(r.mainnet.all, 2, "the connected wallet and one new depositor");
  assert.equal(r.mainnet.byAction.deposit, 2);
  assert.equal(r.mainnet.byAction.cashout_to, 3);
  assert.equal(r.mainnet.allWithCashoutTo, 4);
  assert.equal(r.mainnet.today, r.mainnet.daily.at(-1)!.people);
  assert.equal(r.testnet.all, 0);
  // the next pass: nothing new below the mark, a new block counts, a block with no time yet waits
  vault.wallets.push(
    { kind: "deposit" as const, wallet: wallet(5).toLowerCase(), ts, block: 16 },
    { kind: "deposit" as const, wallet: wallet(6).toLowerCase(), ts: 0, block: 17 },
    { kind: "deposit" as const, wallet: wallet(7).toLowerCase(), ts, block: 18 }
  );
  await store.addChainPeople([vault], now);
  r = await store.readPeople(now);
  assert.equal(r.mainnet.byAction.deposit, 3, "block 16 in; 17 has no time yet, so it and 18 wait");
  vault.wallets[7]!.ts = ts;
  await store.addChainPeople([vault], now);
  r = await store.readPeople(now);
  assert.equal(r.mainnet.byAction.deposit, 5);
  assert.equal(r.mainnet.all, 5);
  for (let i = 1; i <= 7; i++) assert.ok(!leaks(memDump(), wallet(i)), `wallet ${i} is not stored`);
});

// ---------------------------------------------------------------- the same through a fake Redis REST pipeline

await test("through Redis: the wire carries the one-way code, never the address, and Redis keeps registers only", async () => {
  const FAKE = "https://fake-redis.test";
  const db = new Map<string, string>();
  const wire: string[] = [];
  const run = (cmd: (string | number)[]): unknown => {
    const [name, ...rest] = cmd.map(String);
    switch (name!.toUpperCase()) {
      case "PFADD": {
        const regs = hll.decodeHll(db.get(rest[0]!));
        const changed = hll.addToHll(regs, rest.slice(1));
        const had = db.has(rest[0]!);
        db.set(rest[0]!, hll.encodeHll(regs));
        return changed || !had ? 1 : 0;
      }
      case "PFCOUNT":
        return hll.countHll(hll.mergeHll(rest.map((k) => hll.decodeHll(db.get(k)))));
      case "SET":
        if (rest.includes("NX") && db.has(rest[0]!)) return null;
        db.set(rest[0]!, rest[1]!);
        return "OK";
      case "GET":
        return db.get(rest[0]!) ?? null;
      case "INCR": {
        const n = Number(db.get(rest[0]!) ?? 0) + 1;
        db.set(rest[0]!, String(n));
        return n;
      }
      case "EXPIRE":
        return 1;
      default:
        return { error: `fake redis: ${name}` };
    }
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(FAKE)) throw new Error(`unexpected fetch ${url}`);
    const body = String(init?.body ?? "");
    wire.push(body);
    const cmds = JSON.parse(body) as (string | number)[][];
    return new Response(JSON.stringify(cmds.map((c) => ({ result: run(c) }))), { status: 200 });
  }) as typeof fetch;
  delete process.env.GLOAM_PARTNERS_STORE;
  process.env.UPSTASH_REDIS_REST_URL = FAKE;
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  try {
    const ws = [wallet(31), wallet(32), wallet(33)];
    for (const w of ws) assert.equal((await post({ w, env: "mainnet", a: ["connect", "claim"] })).status, 204);
    await post({ w: ws[0], env: "mainnet", a: ["send"] });
    const r = await store.readPeople();
    assert.equal(r.backend, "redis");
    assert.equal(r.mainnet.all, 3);
    assert.equal(r.mainnet.byAction.claim, 3);
    assert.equal(r.mainnet.byAction.send, 1);
    const sent = wire.join("\n").toLowerCase();
    assert.ok(sent.includes(store.personCode(SALT, ws[0]!)), "Redis is given the one-way code");
    for (const w of ws) assert.ok(!sent.includes(w.toLowerCase().slice(2)), "and never the address");
    const kept = [...db.entries()].flat().join("\n").toLowerCase();
    for (const w of ws) assert.ok(!leaks(kept, w), "Redis keeps no address and no code");
    assert.ok(
      [...db.keys()].some((k) => k.startsWith("gloam:mcp:rl:people:")),
      "the rate limit is shared through Redis"
    );
  } finally {
    globalThis.fetch = realFetch;
    process.env.GLOAM_PARTNERS_STORE = "memory";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
});

console.log(`\npeople: ${passed} passed`);
