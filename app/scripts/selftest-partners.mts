/**
 * Self-test: the partner program and the Gloam API v1.
 *
 *  - API keys: format, hashing with the pepper, the pepper rules, create /
 *    rotate / revoke / rename, lookup, per-key rate limit
 *  - Sign-in: SIWE messages signed by a throwaway viem account, every way a
 *    message can be wrong, single-use nonces, the session cookie
 *  - Fees: limits, commission math, micro-units
 *  - Attribution: recording keeps nothing private, a transaction counts once,
 *    totals and per-day figures add up
 *  - v1 routes called directly: the JSON envelope, missing / bad / revoked
 *    keys, live keys refused on testnet, relay errors passed through before
 *    any RPC, payment request links, proof checking with a real Groth16 proof
 *    (made here from a local tree), an exact balance, a gloamdisc1 copied
 *    from a deposit (never ok), the payroll size cap, and the vkeys bundled
 *    for the server matching the pinned hashes
 *
 * Uses the in-process store (GLOAM_PARTNERS_STORE=memory) and the development
 * pepper on localhost. Nothing is signed for real or sent to any chain; the
 * proof check may read isKnownRoot from a public RPC, and passes either way.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-partners.mts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSiweMessage } from "viem/siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

process.env.GLOAM_PARTNERS_STORE = "memory";
delete process.env.GLOAM_API_KEY_PEPPER;
delete process.env.GLOAM_PARTNER_SESSION_SECRET;
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = "test";

const {
  apiKeyPepper,
  createApiKey,
  displayKey,
  generateApiKey,
  hashApiKey,
  isLocalHost,
  keyMatchesHash,
  listApiKeys,
  lookupApiKey,
  meterApiKey,
  parseApiKey,
  renameApiKey,
  revokeApiKey,
  rotateApiKey,
  KEY_RATE_LIMIT,
  MAX_ACTIVE_KEYS,
  bearerKey,
} = await import("../src/lib/apiKeys");
const { resetMemoryKv, kvBackend } = await import("../src/lib/partnersKv");
const {
  commissionFor,
  describeFee,
  getPartnerByOwner,
  listPartners,
  readAllPartnerTotals,
  readPartnerStats,
  recordActivity,
  toMicroUnits,
  upsertPartner,
  validateFees,
  cleanWebsite,
  validatePayout,
  DEFAULT_FEES,
} = await import("../src/lib/partners");
const { SIWE_STATEMENT, createSession, issueNonce, nonceAllowed, readSession, verifySignIn } = await import("../src/lib/partnersAuth");
const { getNetwork, MAINNET_ENABLED } = await import("../src/lib/networks");
const { PROOF_ARTIFACTS } = await import("../src/lib/proofs/artifacts");
const { CIRCUIT_ARTIFACTS } = await import("../src/lib/circuitArtifacts");
const { encodeProof } = await import("../src/lib/proofs");
const { verifyProofText, groth16Verify, SNARK_CHECK } = await import("../src/app/api/v1/_lib/verify");
const { GET: meGet } = await import("../src/app/api/v1/me/route");
const { POST: relayPost } = await import("../src/app/api/v1/relay/route");
const { POST: requestPost } = await import("../src/app/api/v1/payment-requests/route");
const { GET: indexGet } = await import("../src/app/api/v1/route");
const { POST: depositPost } = await import("../src/app/api/v1/deposits/route");
const { GET: nonceGet } = await import("../src/app/api/partners/nonce/route");
const { POST: sessionPost, GET: sessionGet } = await import("../src/app/api/partners/session/route");
const { PUT: accountPut } = await import("../src/app/api/partners/account/route");
const { POST: keysPost, GET: keysGet } = await import("../src/app/api/partners/keys/route");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const HOST = "localhost:3121";
const ORIGIN = `http://${HOST}`;
const RH = getNetwork("robinhood");
const TEMPO = getNetwork("tempo");
const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F" as Address;
const pepper = (() => {
  const p = apiKeyPepper(HOST);
  if (!p.ok) throw new Error("dev pepper should apply on localhost");
  return p.pepper;
})();

function req(path: string, init: { method?: string; key?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "x-forwarded-host": HOST };
  if (init.key) headers.authorization = `Bearer ${init.key}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin !== null && init.method && init.method !== "GET") headers.origin = init.origin ?? ORIGIN;
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

type Envelope = { v: number; ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string }; requestId: string };
async function json(res: Response): Promise<Envelope> {
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("gloam-api-version"), "1");
  const body = (await res.json()) as Envelope;
  assert.equal(body.v, 1);
  assert.match(body.requestId, /^req_[0-9a-f]{16}$/);
  return body;
}

resetMemoryKv();

// ---------------------------------------------------------------- keys

await test("store is the in-process one", () => {
  assert.equal(kvBackend(), "memory");
});

await test("keys: format and display", () => {
  const t = generateApiKey("test");
  const l = generateApiKey("live");
  assert.match(t, /^gloam_test_[A-Za-z0-9_-]{43}$/);
  assert.match(l, /^gloam_live_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(parseApiKey(t)?.env, "test");
  assert.deepEqual(parseApiKey(l)?.env, "live");
  assert.equal(parseApiKey("gloam_test_short"), null);
  assert.equal(parseApiKey("gloam_prod_" + "a".repeat(43)), null);
  assert.equal(parseApiKey(t + "x"), null);
  assert.equal(parseApiKey(null), null);
  const d = displayKey(t);
  assert.ok(d.startsWith("gloam_test_") && d.includes("…"));
  assert.ok(!d.includes(t.slice(15, 39)), "display hides the middle");
  assert.notEqual(generateApiKey("test"), generateApiKey("test"));
  assert.equal(bearerKey(`Bearer ${t}`), t);
  assert.equal(bearerKey(`bearer   ${t}  `), t);
  assert.equal(bearerKey(t), null);
});

await test("keys: hashed with the pepper, never stored plain", () => {
  const t = generateApiKey("test");
  const h1 = hashApiKey(t, pepper);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(hashApiKey(t, pepper), h1);
  assert.notEqual(hashApiKey(t, pepper + "x"), h1);
  assert.notEqual(h1, createHash("sha256").update(t).digest("hex"), "not a bare sha256");
  assert.ok(keyMatchesHash(t, h1, pepper));
  assert.ok(!keyMatchesHash(generateApiKey("test"), h1, pepper));
});

await test("pepper: dev default only on localhost outside production", () => {
  assert.ok(isLocalHost("localhost:3121") && isLocalHost("127.0.0.1") && isLocalHost("[::1]:80") && isLocalHost("app.localhost"));
  assert.ok(!isLocalHost("gloam.trade") && !isLocalHost("localhost.evil.com") && !isLocalHost(null));
  assert.equal(apiKeyPepper("localhost:3121").ok, true);
  assert.deepEqual(apiKeyPepper("gloam.trade"), { ok: false, reason: "missing" });
  env.NODE_ENV = "production";
  assert.deepEqual(apiKeyPepper("localhost:3121"), { ok: false, reason: "missing" }, "production never uses the dev pepper");
  env.GLOAM_API_KEY_PEPPER = "too-short";
  assert.deepEqual(apiKeyPepper("gloam.trade"), { ok: false, reason: "short" });
  env.GLOAM_API_KEY_PEPPER = "p".repeat(40);
  const p = apiKeyPepper("gloam.trade");
  assert.ok(p.ok && p.source === "env" && p.pepper === "p".repeat(40));
  delete env.GLOAM_API_KEY_PEPPER;
  env.NODE_ENV = "test";
});

// ---------------------------------------------------------------- fees

await test("fees: limits", () => {
  assert.deepEqual(validateFees(undefined), DEFAULT_FEES);
  assert.deepEqual(validateFees({ privatePaymentCents: 5, cashoutBps: 25 }), { privatePaymentCents: 5, cashoutBps: 25, depositBps: 0 });
  assert.deepEqual(validateFees({ depositBps: "10" }), { ...DEFAULT_FEES, depositBps: 10 });
  for (const bad of [{ privatePaymentCents: 101 }, { privatePaymentCents: -1 }, { cashoutBps: 1.5 }, { cashoutBps: 101 }, { depositBps: "x" }, { depositBps: null }]) {
    assert.throws(() => validateFees(bad), /fee/i, JSON.stringify(bad));
  }
  assert.throws(() => validateFees("5"));
});

await test("fees: commission math", () => {
  const fees = { privatePaymentCents: 5, cashoutBps: 25, depositBps: 10 };
  // Private payment: flat, nothing about the amount.
  assert.deepEqual(commissionFor("private_payment", fees), { feeUsdMicros: 50_000n, feeToken: null, volumeUsdMicros: null });
  // Cash out 250 USDG (6 decimals) at $1: 0.25% = 0.625 USDG = $0.625.
  const c = commissionFor("cash_out", fees, { amount: 250_000_000n, decimals: 6, priceMicros: 1_000_000n });
  assert.equal(c.feeToken, 625_000n);
  assert.equal(c.volumeUsdMicros, 250_000_000n);
  assert.equal(c.feeUsdMicros, 625_000n);
  // Deposit 0.5 ETH at $3,000: 0.10% = 0.0005 ETH = $1.50.
  const d = commissionFor("deposit", fees, { amount: 5n * 10n ** 17n, decimals: 18, priceMicros: 3_000_000_000n });
  assert.equal(d.feeToken, 5n * 10n ** 14n);
  assert.equal(d.volumeUsdMicros, 1_500_000_000n);
  assert.equal(d.feeUsdMicros, 1_500_000n);
  // No price: the token fee still applies, the USD figures are unknown.
  const u = commissionFor("cash_out", fees, { amount: 10n ** 18n, decimals: 18, priceMicros: null });
  assert.equal(u.feeToken, 25n * 10n ** 14n);
  assert.equal(u.feeUsdMicros, null);
  assert.equal(u.volumeUsdMicros, null);
  // Rounds down, never up.
  assert.equal(commissionFor("cash_out", fees, { amount: 3n, decimals: 6, priceMicros: 1_000_000n }).feeToken, 0n);
  assert.equal(toMicroUnits(10n ** 18n, 18), 1_000_000n);
  assert.equal(toMicroUnits(1_234_567n, 6), 1_234_567n);
  assert.equal(toMicroUnits(5n, 2), 50_000n);
  assert.equal(describeFee("private_payment", fees), "$0.05 per private payment");
  assert.equal(describeFee("cash_out", fees), "0.25% of each cash out");
});

await test("partner fields: website and payout addresses", () => {
  assert.equal(cleanWebsite("acme.app"), "https://acme.app");
  assert.equal(cleanWebsite(" https://acme.app/pay/ "), "https://acme.app/pay");
  assert.equal(cleanWebsite(""), null);
  assert.throws(() => cleanWebsite("javascript:alert(1)"));
  assert.throws(() => cleanWebsite("ftp://acme.app"));
  assert.throws(() => cleanWebsite("https://user:pw@acme.app"));
  const a = privateKeyToAccount(generatePrivateKey()).address;
  assert.deepEqual(validatePayout({ robinhood: a.toLowerCase() }), { robinhood: a });
  assert.deepEqual(validatePayout({ robinhood: "" }, { robinhood: a }), {});
  assert.throws(() => validatePayout({ solana: a }));
  assert.throws(() => validatePayout({ tempo: "0x0000000000000000000000000000000000000000" }));
  assert.throws(() => validatePayout({ tempo: "0x123" }));
});

// ---------------------------------------------------------------- sign-in

const wallet = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

async function signIn(over: Partial<Parameters<typeof createSiweMessage>[0]> = {}, signer = wallet) {
  const { nonce } = await issueNonce();
  const now = new Date();
  const message = createSiweMessage({
    domain: HOST,
    address: wallet.address,
    statement: SIWE_STATEMENT,
    uri: ORIGIN,
    version: "1",
    chainId: 46630,
    nonce,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 30 * 60_000),
    ...over,
  });
  const signature = await signer.signMessage({ message });
  return { message, signature };
}

await test("sign-in: a good message signs in once", async () => {
  const { message, signature } = await signIn();
  assert.equal(await verifySignIn({ message, signature, host: HOST }), wallet.address);
  await assert.rejects(verifySignIn({ message, signature, host: HOST }), /already used|expired/i, "nonce is single use");
});

await test("sign-in: wrong site, statement, signer, nonce, times are refused", async () => {
  const cases: [string, () => Promise<unknown>][] = [];
  {
    const s = await signIn({ domain: "evil.example" });
    cases.push(["domain", () => verifySignIn({ ...s, host: HOST })]);
  }
  {
    const s = await signIn({ uri: "https://evil.example" });
    cases.push(["uri", () => verifySignIn({ ...s, host: HOST })]);
  }
  {
    const s = await signIn({ statement: "Approve everything" });
    cases.push(["statement", () => verifySignIn({ ...s, host: HOST })]);
  }
  {
    const s = await signIn({}, stranger);
    cases.push(["signer", () => verifySignIn({ ...s, host: HOST })]);
  }
  {
    const s = await signIn({ nonce: "0123456789abcdef0123456789abcdef" });
    cases.push(["unknown nonce", () => verifySignIn({ ...s, host: HOST })]);
  }
  {
    const old = new Date(Date.now() - 20 * 60_000);
    const s = await signIn({ issuedAt: old, expirationTime: new Date(old.getTime() + 30 * 60_000) });
    cases.push(["stale", () => verifySignIn({ ...s, host: HOST })]);
  }
  {
    const s = await signIn({ expirationTime: new Date(Date.now() + 5 * 3600_000) });
    cases.push(["long-lived", () => verifySignIn({ ...s, host: HOST })]);
  }
  {
    const s = await signIn({ expirationTime: undefined });
    cases.push(["no expiry", () => verifySignIn({ ...s, host: HOST })]);
  }
  {
    const s = await signIn();
    cases.push(["other host", () => verifySignIn({ ...s, host: "gloam.trade" })]);
    cases.push(["bad signature", () => verifySignIn({ message: s.message, signature: "0x1234", host: HOST })]);
  }
  for (const [name, run] of cases) await assert.rejects(run(), Error, name);
});

await test("sign-in: a refused message does not burn its nonce", async () => {
  const s = await signIn();
  const forged = await stranger.signMessage({ message: s.message });
  await assert.rejects(verifySignIn({ message: s.message, signature: forged, host: HOST }));
  assert.equal(await verifySignIn({ ...s, host: HOST }), wallet.address);
});

await test("sign-in: pinned domains and nonce issue cap", async () => {
  env.GLOAM_PARTNER_DOMAINS = "gloam.trade, www.gloam.trade";
  const pinned = await signIn({ domain: "www.gloam.trade", uri: "https://www.gloam.trade" });
  assert.equal(await verifySignIn({ ...pinned, host: "internal-proxy:8080" }), wallet.address, "pinned domain accepted whatever the host header says");
  const local = await signIn();
  await assert.rejects(verifySignIn({ ...local, host: HOST }), /different site/, "unpinned domain refused once pinned");
  delete env.GLOAM_PARTNER_DOMAINS;
  const t = Date.UTC(2031, 0, 1);
  for (let i = 0; i < 30; i++) assert.ok(nonceAllowed("10.0.0.9", t));
  assert.equal(nonceAllowed("10.0.0.9", t), false);
  assert.ok(nonceAllowed("10.0.0.10", t), "other clients unaffected");
  assert.ok(nonceAllowed("10.0.0.9", t + 11 * 60_000), "window passes");
});

await test("session cookie: round trip, tamper, expiry", () => {
  const token = createSession(wallet.address, HOST)!;
  assert.ok(token);
  assert.equal(readSession(token, HOST), wallet.address);
  assert.equal(readSession(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), HOST), null);
  assert.equal(readSession(token.replace(wallet.address.toLowerCase(), stranger.address.toLowerCase()), HOST), null);
  assert.equal(readSession(token, HOST, Date.now() + 8 * 86_400_000), null);
  assert.equal(readSession(token, "gloam.trade"), null, "no secret off localhost in dev");
  assert.equal(readSession(undefined, HOST), null);
});

// ---------------------------------------------------------------- portal routes

let cookie = "";
await test("portal: nonce, sign in, account, keys over HTTP", async () => {
  const n = await json(await nonceGet(req("/api/partners/nonce")));
  assert.ok(n.ok && typeof n.data!.nonce === "string" && n.data!.statement === SIWE_STATEMENT);
  const now = new Date();
  const message = createSiweMessage({
    domain: HOST,
    address: wallet.address,
    statement: SIWE_STATEMENT,
    uri: ORIGIN,
    version: "1",
    chainId: 46630,
    nonce: n.data!.nonce as string,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 10 * 60_000),
  });
  const signature = await wallet.signMessage({ message });

  const crossSite = await sessionPost(req("/api/partners/session", { method: "POST", body: { message, signature }, origin: "https://evil.example" }) as never);
  assert.equal(crossSite.status, 403);

  const res = await sessionPost(req("/api/partners/session", { method: "POST", body: { message, signature } }) as never);
  const body = await json(res);
  assert.ok(body.ok, JSON.stringify(body));
  const set = res.headers.get("set-cookie") ?? "";
  assert.match(set, /gloam_partner=v1\./);
  assert.match(set, /HttpOnly/i);
  assert.match(set, /SameSite=lax/i);
  cookie = set.split(";")[0]!;

  const me = await json(await sessionGet(req("/api/partners/session", { cookie }) as never));
  assert.equal(me.data!.wallet, wallet.address);
  assert.equal(me.data!.partner, null);
  const out = await sessionGet(req("/api/partners/session") as never);
  assert.equal(out.status, 401);

  const noName = await accountPut(req("/api/partners/account", { method: "PUT", cookie, body: { name: "" } }) as never);
  assert.equal(noName.status, 400);
  const acct = await json(
    await accountPut(
      req("/api/partners/account", {
        method: "PUT",
        cookie,
        body: { name: "Acme Pay", website: "acme.app", fees: { privatePaymentCents: 5, cashoutBps: 25 }, payout: { robinhood: wallet.address } },
      }) as never
    )
  );
  assert.ok(acct.ok, JSON.stringify(acct));
  const p = acct.data!.partner as { name: string; website: string; fees: { cashoutBps: number } };
  assert.equal(p.name, "Acme Pay");
  assert.equal(p.website, "https://acme.app");
  assert.equal(p.fees.cashoutBps, 25);

  const made = await json(await keysPost(req("/api/partners/keys", { method: "POST", cookie, body: { name: "Server" } }) as never));
  assert.ok(made.ok && typeof made.data!.secret === "string");
  const live = await json(await keysPost(req("/api/partners/keys", { method: "POST", cookie, body: { name: "Live", env: "live" } }) as never));
  // Live keys open once a mainnet pool is filled in (lib/mainnet.ts); before that they are refused.
  if (MAINNET_ENABLED) assert.ok(live.ok && typeof live.data!.secret === "string", "live keys open with mainnet");
  else assert.equal(live.error!.code, "live_unavailable");
  const list = await json(await keysGet(req("/api/partners/keys", { cookie }) as never));
  const keys = list.data!.keys as { name: string }[];
  assert.equal(keys.length, MAINNET_ENABLED ? 2 : 1);
  assert.ok(!JSON.stringify(list).includes(made.data!.secret as string), "listing never shows the secret");
  assert.ok(!JSON.stringify(list).includes('"hash"'), "listing never shows the hash");
});

// ---------------------------------------------------------------- keys in the store

const partner = (await getPartnerByOwner(wallet.address))!;
let secret = "";
let keyId = "";

await test("keys: create, lookup, rename, rotate, revoke", async () => {
  const made = await createApiKey({ partnerId: partner.id, name: "  Payroll‮ bot  ", env: "test", pepper });
  secret = made.secret;
  keyId = made.key.id;
  assert.equal(made.key.name, "Payroll bot", "control characters dropped");
  assert.deepEqual(await lookupApiKey(secret, pepper), { id: keyId, partnerId: partner.id, env: "test" });
  assert.equal(await lookupApiKey(secret, pepper + "x"), null, "other pepper, no match");
  assert.equal(await lookupApiKey(generateApiKey("test"), pepper), null);

  assert.equal((await renameApiKey({ partnerId: partner.id, keyId, name: "Payroll" })).name, "Payroll");
  await assert.rejects(renameApiKey({ partnerId: "ptr_someoneelse", keyId, name: "x" }), /No such key/);

  const rotated = await rotateApiKey({ partnerId: partner.id, keyId, pepper });
  assert.notEqual(rotated.secret, secret);
  assert.equal(await lookupApiKey(secret, pepper), null, "old secret stops at once");
  assert.ok(await lookupApiKey(rotated.secret, pepper));
  secret = rotated.secret;

  const spare = await createApiKey({ partnerId: partner.id, name: "Spare", env: "test", pepper });
  await revokeApiKey({ partnerId: partner.id, keyId: spare.key.id });
  assert.equal(await lookupApiKey(spare.secret, pepper), null, "revoked");
  await assert.rejects(rotateApiKey({ partnerId: partner.id, keyId: spare.key.id, pepper }), /revoked/);
  const views = await listApiKeys(partner.id);
  assert.equal(views.find((v) => v.id === spare.key.id)?.revokedAt != null, true);
  assert.ok(!JSON.stringify(views).includes("hash"));
});

await test("keys: at most MAX_ACTIVE_KEYS active", async () => {
  const other = await upsertPartner(stranger.address, { name: "Busy" });
  for (let i = 0; i < MAX_ACTIVE_KEYS; i++) await createApiKey({ partnerId: other.id, name: `k${i}`, env: "test", pepper });
  await assert.rejects(createApiKey({ partnerId: other.id, name: "one more", env: "test", pepper }), /active keys/);
});

await test("keys: per-minute limit", async () => {
  const t0 = Date.UTC(2030, 0, 1, 0, 0, 5);
  let last;
  for (let i = 0; i < KEY_RATE_LIMIT; i++) last = await meterApiKey("key_ratetest", t0);
  assert.equal(last!.allowed, true);
  assert.equal(last!.remaining, 0);
  const over = await meterApiKey("key_ratetest", t0 + 1000);
  assert.equal(over.allowed, false);
  const next = await meterApiKey("key_ratetest", t0 + 60_000);
  assert.equal(next.allowed, true, "a new minute starts fresh");
});

// ---------------------------------------------------------------- attribution

const TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

await test("attribution: private payments keep no amount, asset or recipient", async () => {
  const r = await recordActivity({ partner, keyId, network: RH, kind: "private_payment", txHash: TX(1) });
  assert.ok(r.recorded);
  const rec = r.record;
  assert.equal(rec.asset, null);
  assert.equal(rec.amount, null);
  assert.equal(rec.volumeUsd, null);
  assert.equal(rec.feeUsd, 0.05);
  assert.deepEqual(
    Object.keys(rec).sort(),
    ["amount", "asset", "chainId", "decimals", "feeBasis", "feeToken", "feeUsd", "id", "keyId", "kind", "network", "symbol", "ts", "txHash", "volumeUsd"].sort()
  );
});

await test("attribution: a transaction counts once, for one partner", async () => {
  const again = await recordActivity({ partner, keyId, network: RH, kind: "private_payment", txHash: TX(1) });
  assert.deepEqual(again, { recorded: false, reason: "duplicate" });
  const upper = await recordActivity({ partner, keyId, network: RH, kind: "private_payment", txHash: TX(1).toUpperCase().replace("0X", "0x") as Hex });
  assert.equal(upper.recorded, false, "hash case does not matter");
  const otherChain = await recordActivity({ partner, keyId, network: TEMPO, kind: "private_payment", txHash: TX(1) });
  assert.equal(otherChain.recorded, true, "same hash on another chain is another transaction");
});

await test("attribution: public edges are valued and summed", async () => {
  const c = await recordActivity({ partner, keyId, network: RH, kind: "cash_out", txHash: TX(2), edge: { asset: USDG, amount: 250_000_000n } });
  assert.ok(c.recorded);
  assert.equal(c.record.symbol, "USDG");
  assert.equal(c.record.volumeUsd, 250);
  assert.equal(c.record.feeUsd, 0.625);
  assert.equal(c.record.feeToken, "625000");
  // A stock token has no price here: counted, not valued.
  const tsla = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" as Address;
  const s = await recordActivity({ partner, keyId, network: RH, kind: "cash_out", txHash: TX(3), edge: { asset: tsla, amount: 10n ** 18n } });
  assert.ok(s.recorded && s.record.feeUsd === null && s.record.feeToken === "2500000000000000");

  const stats = await readPartnerStats(partner.id, { recent: 10 });
  assert.equal(stats.totals.privatePayments, 2);
  assert.equal(stats.totals.cashOuts, 2);
  assert.equal(stats.totals.publicVolumeUsd, 250);
  assert.equal(stats.totals.unpriced, 1);
  assert.ok(Math.abs(stats.totals.commissionUsd - (0.05 * 2 + 0.625)) < 1e-9);
  assert.equal(stats.byNetwork.robinhood.private_payment, 1);
  assert.equal(stats.byNetwork.tempo.private_payment, 1);
  const usdg = stats.byAsset.find((a) => a.symbol === "USDG")!;
  assert.equal(usdg.volume, "250");
  assert.equal(usdg.commission, "0.625");
  assert.equal(stats.recent.length, 4);
  assert.equal(stats.recent[0]!.txHash, TX(3), "newest first");
  const today = stats.daily[stats.daily.length - 1]!;
  assert.equal(today.privatePayments, 2);
  assert.equal(today.cashOuts, 2);
  assert.equal(stats.daily.length, 14);

  const all = await readPartnerStats("all");
  assert.equal(all.totals.cashOuts, 2);
  const totals = await readAllPartnerTotals((await listPartners()).map((p) => p.id));
  assert.equal(totals[partner.id]!.privatePayments, 2);
});

await test("attribution: fee setting applies at the time of the transaction", async () => {
  const updated = await upsertPartner(wallet.address, { fees: { privatePaymentCents: 20 } });
  const r = await recordActivity({ partner: updated, keyId, network: RH, kind: "private_payment", txHash: TX(4) });
  assert.ok(r.recorded && r.record.feeUsd === 0.2);
  const stats = await readPartnerStats(partner.id, { recent: 5 });
  assert.ok(stats.recent.some((x) => x.txHash === TX(1) && x.feeUsd === 0.05), "earlier records keep their fee");
  await upsertPartner(wallet.address, { fees: { privatePaymentCents: 5 } });
});

// ---------------------------------------------------------------- v1 routes

await test("v1: index needs no key", async () => {
  const b = await json(await indexGet());
  assert.ok(b.ok && Array.isArray(b.data!.endpoints));
});

await test("v1: missing, malformed, unknown and revoked keys are refused as JSON", async () => {
  const none = await meGet(req("/api/v1/me"));
  assert.equal(none.status, 401);
  assert.equal((await json(none)).error!.code, "missing_key");
  const junk = await meGet(req("/api/v1/me", { key: "sk_live_123" }));
  assert.equal((await json(junk)).error!.code, "invalid_key");
  const unknown = await meGet(req("/api/v1/me", { key: generateApiKey("test") }));
  assert.equal(unknown.status, 401);
  assert.equal((await json(unknown)).error!.code, "invalid_key");
  const gone = await createApiKey({ partnerId: partner.id, name: "Gone", env: "test", pepper });
  assert.equal((await meGet(req("/api/v1/me", { key: gone.secret }))).status, 200);
  await revokeApiKey({ partnerId: partner.id, keyId: gone.key.id });
  const revoked = await meGet(req("/api/v1/me", { key: gone.secret }));
  assert.equal(revoked.status, 401);
  assert.equal((await json(revoked)).error!.code, "invalid_key");
});

await test("v1: a good key reads its partner, with rate headers", async () => {
  const res = await meGet(req("/api/v1/me", { key: secret }));
  const b = await json(res);
  assert.ok(b.ok, JSON.stringify(b));
  assert.equal((b.data!.partner as { name: string }).name, "Acme Pay");
  assert.equal(b.data!.charged, false);
  assert.equal(res.headers.get("x-ratelimit-limit"), String(KEY_RATE_LIMIT));
  assert.ok(Number(res.headers.get("x-ratelimit-remaining")) < KEY_RATE_LIMIT);
});

await test("v1 relay: live key refused on testnet; relay validation errors pass through", async () => {
  const live = await createApiKey({ partnerId: partner.id, name: "Live", env: "live", pepper });
  const refused = await relayPost(req("/api/v1/relay", { method: "POST", key: live.secret, body: { chainId: 46630, action: "transfer" } }));
  assert.equal(refused.status, 403);
  assert.equal((await json(refused)).error!.code, "key_env_mismatch");
  await revokeApiKey({ partnerId: partner.id, keyId: live.key.id });

  const badProof = await relayPost(req("/api/v1/relay", { method: "POST", key: secret, body: { chainId: 46630, action: "transfer", proof: "0x12" } }));
  assert.equal(badProof.status, 400);
  assert.equal((await json(badProof)).error!.message, "Invalid proof.");
  const badNet = await relayPost(req("/api/v1/relay", { method: "POST", key: secret, body: { chainId: 1, action: "transfer" } }));
  assert.equal((await json(badNet)).error!.code, "network");
  const badAction = await relayPost(req("/api/v1/relay", { method: "POST", key: secret, body: { chainId: 46630, action: "shield" } }));
  assert.equal((await json(badAction)).error!.code, "bad_action");
  const notJson = await relayPost(new Request(`${ORIGIN}/api/v1/relay`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "x-forwarded-host": HOST }, body: "nope" }));
  assert.equal((await json(notJson)).error!.code, "invalid_json");
  const stats = await readPartnerStats(partner.id);
  assert.equal(stats.totals.privatePayments, 3, "refused relays are not attributed");
});

await test("v1 deposits: malformed hashes refused before any RPC", async () => {
  const bad = await depositPost(req("/api/v1/deposits", { method: "POST", key: secret, body: { chainId: 46630, txHash: "0x12" } }));
  assert.equal((await json(bad)).error!.code, "bad_tx");
});

await test("v1 payment requests: link with the details after the #", async () => {
  const tag = "gloamr1." + "A".repeat(60);
  const res = await requestPost(
    req("/api/v1/payment-requests", { method: "POST", key: secret, body: { to: tag, network: "robinhood", asset: "usdg", amount: "1,250.50", note: "Invoice 042", name: "Acme" } })
  );
  const b = await json(res);
  assert.equal(res.status, 201);
  const url = new URL(b.data!.url as string);
  assert.equal(url.origin, ORIGIN);
  assert.equal(url.pathname, "/app/vault");
  assert.equal(url.search, "?tab=move&mode=pay");
  const frag = new URLSearchParams(url.hash.slice(1));
  assert.equal(frag.get("to"), tag);
  assert.equal(frag.get("amount"), "1250.5");
  assert.equal(frag.get("asset"), USDG);
  assert.equal(frag.get("note"), "Invoice 042");
  for (const [body, code] of [
    [{ to: "nope", asset: "USDG" }, "bad_tag"],
    [{ to: tag, network: "solana", asset: "USDG" }, "unknown_network"],
    [{ to: tag, asset: "DOGE" }, "unknown_asset"],
    [{ to: tag, asset: "USDG", amount: "1.2345678" }, "bad_amount"],
  ] as const) {
    const r = await requestPost(req("/api/v1/payment-requests", { method: "POST", key: secret, body }));
    assert.equal((await json(r)).error!.code, code, JSON.stringify(body));
  }
});

// ---------------------------------------------------------------- proofs

const here = fileURLToPath(new URL(".", import.meta.url));
const circuits = join(here, "../public/circuits");

await test("proofs: server checking keys match the pinned hashes", () => {
  for (const name of ["funds", "receipt", "payroll"] as const) {
    const a = PROOF_ARTIFACTS[name].vkey;
    const bytes = readFileSync(join(circuits, a.path.replace("/circuits/", "")));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), a.sha256, name);
  }
  // The older disclosure's key is pinned too (lib/disclosure checks it before use).
  const shield = CIRCUIT_ARTIFACTS.shieldVkey;
  assert.equal(createHash("sha256").update(readFileSync(join(circuits, "shield_vkey.json"))).digest("hex"), shield.sha256, "shield");
});

await test("proofs: a gloamdisc1 copied from a deposit is never ok (ZK-2)", async () => {
  // What anyone can lift off the chain: a deposit's own shield proof, wrapped as a disclosure.
  const sdk = await import("@gloamtrade/sdk");
  const snarkjs = await import("snarkjs");
  const secret = 4242n;
  const amount = 5_000_000n;
  const commitment = await sdk.noteCommitmentPoseidon(secret, amount, USDG);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { commitment: commitment.toString(), amount: amount.toString(), asset: BigInt(USDG).toString(), secret: secret.toString() },
    join(circuits, "shield.wasm"),
    join(circuits, "shield_final.zkey")
  );
  const d = { v: 1, chainId: RH.chainId, pool: RH.pool!, commitment: publicSignals[0], amount: publicSignals[1], asset: publicSignals[2], proof };
  const r = await verifyProofText("gloamdisc1:" + Buffer.from(JSON.stringify(d)).toString("base64"));
  assert.equal(r.format, "gloamdisc1");
  assert.equal(r.checks[0]!.label, SNARK_CHECK);
  assert.equal(r.checks[0]!.state, "pass", "the math of a copied deposit proof holds");
  const who = r.checks.find((c) => c.label === "Shows who holds it");
  assert.equal(who?.state, "fail");
  assert.match(who?.detail ?? "", /anyone can copy one from a public deposit/);
  assert.equal(r.ok, false, "but it is never ok");
});

await test("proofs: an exact balance (gloambal1) is checked on the server", async () => {
  const sdk = await import("@gloamtrade/sdk");
  const snarkjs = await import("snarkjs");
  const pool = RH.pool!;
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const context = sdk.proofContext({ kind: "balance", chainId: RH.chainId, pool, verifier: "Acme Bank", expiresAt });
  const tree = new sdk.IncrementalMerkleTreePoseidon();
  const amount = 700n;
  const index = await tree.insert(await sdk.noteCommitmentPoseidon(3333n, amount, USDG));
  const w = await sdk.buildReceiptWitness({ secretHex: sdk.fieldToHex(3333n), amount, asset: USDG, path: await tree.path(index), reveal: true, minAmount: amount, context });
  assert.equal(w.blocker, null);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(w.circomInput as Record<string, unknown>, join(circuits, "receipt.wasm"), join(circuits, "receipt_final.zkey"));
  const bal = { v: 1 as const, kind: "balance" as const, chainId: RH.chainId, pool, verifier: "Acme Bank", expiresAt, asset: USDG, commitment: sdk.fieldToHex(w.publicInputs.commitment), amount: "700", proof, publicSignals };
  const r = await verifyProofText(encodeProof(bal));
  assert.equal(r.format, "gloambal1");
  const byLabel = new Map(r.checks.map((c) => [c.label, c.state]));
  assert.equal(r.checks[0]!.state, "pass", JSON.stringify(r.checks));
  assert.equal(byLabel.get('Made for "Acme Bank"'), "pass");
  assert.equal(byLabel.get("Asset and amount match the proof"), "pass");
  // A local tree's root was never the vault's (or the RPC is unreachable): never ok.
  assert.notEqual(byLabel.get("Matches a real vault state"), "pass");
  assert.equal(r.ok, false);
  // Relabelled as a proof of payment: the sealed kind does not match.
  const asPay = await verifyProofText(encodeProof({ ...bal, kind: "payment", minAmount: "700", txHash: null } as never));
  assert.equal(new Map(asPay.checks.map((c) => [c.label, c.state])).get('Made for "Acme Bank"'), "fail");
});

await test("proofs: a payroll proof over the size cap is refused before any work (ZK-4)", async () => {
  const big = {
    v: 1, kind: "payroll", chainId: RH.chainId, pool: RH.pool!, verifier: "Tax office", expiresAt: Math.floor(Date.now() / 1000) + 3600,
    asset: USDG, total: "1", count: 300,
    payments: Array.from({ length: 300 }, () => ({ commitment: "0x" + "11".repeat(32), nullifier: "0x" + "22".repeat(32), txHash: null })),
    parts: [{ proof: {}, publicSignals: ["1"] }],
  };
  await assert.rejects(verifyProofText("gloamroll1:" + Buffer.from(JSON.stringify(big)).toString("base64")), /damaged/);
  await assert.rejects(verifyProofText("gloamroll1:" + "A".repeat(170_000)), /too large/);
});

await test("proofs: malformed input is a 400, not a crash", async () => {
  await assert.rejects(verifyProofText(""), /proof/);
  await assert.rejects(verifyProofText("gloamfunds1:!!!"), /damaged|Not a Gloam/);
  await assert.rejects(verifyProofText("not a proof"), /Not a Gloam proof|not a Gloam proof/i);
  assert.equal(await groth16Verify({}, ["1"], {}), false);
});

await test("proofs: a real proof of funds passes the server snark check", async () => {
  const sdk = await import("@gloamtrade/sdk");
  const snarkjs = await import("snarkjs");
  const pool = RH.pool!;
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const context = sdk.proofContext({ kind: "funds", chainId: RH.chainId, pool, verifier: "Acme Bank", expiresAt });
  const tree = new sdk.IncrementalMerkleTreePoseidon();
  const notes = [] as { secret: bigint; amount: bigint; index: number }[];
  for (const [secret, amount] of [[1111n, 600n], [2222n, 500n]] as const) {
    const commitment = await sdk.noteCommitmentPoseidon(secret, amount, USDG);
    notes.push({ secret, amount, index: await tree.insert(commitment) });
  }
  const w = await sdk.buildFundsWitness({
    asset: USDG,
    threshold: 1000n,
    context,
    notes: await Promise.all(notes.map(async (n) => ({ secretHex: sdk.fieldToHex(n.secret), amount: n.amount, path: await tree.path(n.index) }))),
  });
  assert.equal(w.blocker, null);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    w.circomInput as Record<string, unknown>,
    join(circuits, "funds.wasm"),
    join(circuits, "funds_final.zkey")
  );
  const nullifiers = w.publicInputs.nullifiers.filter((n: bigint) => n !== 0n).map(sdk.fieldToHex);
  const fundsProof = {
    v: 1 as const,
    kind: "funds" as const,
    chainId: RH.chainId,
    pool,
    verifier: "Acme Bank",
    expiresAt,
    asset: USDG,
    threshold: "1000",
    root: sdk.fieldToHex(w.publicInputs.root),
    nullifiers,
    proof,
    publicSignals,
  };
  const r = await verifyProofText(encodeProof(fundsProof));
  assert.equal(r.format, "gloamfunds1");
  const byLabel = new Map(r.checks.map((c) => [c.label, c.state]));
  assert.equal(r.checks[0]!.label, SNARK_CHECK);
  assert.equal(r.checks[0]!.state, "pass", JSON.stringify(r.checks));
  assert.equal(byLabel.get('Made for "Acme Bank"'), "pass");
  assert.equal(byLabel.get("Made on Gloam's vault on Robinhood Chain"), "pass");
  assert.equal(byLabel.get("Asset and amount match the proof"), "pass");
  // The root is from a local tree, so the vault never had it (or the RPC is unreachable).
  assert.notEqual(byLabel.get("Matches a real vault state"), "pass");
  assert.equal(r.ok, false);

  // Edit a signal: the snark no longer holds.
  const forged = { ...fundsProof, publicSignals: [...publicSignals] };
  forged.publicSignals[2] = "1";
  const f = await verifyProofText(encodeProof(forged));
  assert.equal(f.checks[0]!.state, "fail");
  assert.equal(f.ok, false);
  // Edit a plain field: the proof holds, the fields do not match.
  const lied = await verifyProofText(encodeProof({ ...fundsProof, threshold: "100000" }));
  assert.equal(lied.checks[0]!.state, "pass");
  assert.equal(new Map(lied.checks.map((c) => [c.label, c.state])).get("Asset and amount match the proof"), "fail");
  // Another vault: refused.
  const elsewhere = await verifyProofText(encodeProof({ ...fundsProof, pool: "0x1111111111111111111111111111111111111111" as Address }));
  assert.equal(elsewhere.ok, false);
});

console.log(`\n${passed} partner tests passed`);
process.exit(0);
