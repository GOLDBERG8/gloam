/**
 * Self-test: Sent links records (lib/sentLinks.ts), the pure parts.
 *
 *  - a record's kind and lock follow its code; the note is cleaned
 *  - records survive a JSON round trip (what sealJson stores) and junk is dropped
 *  - at most 100 per network and pool, newest kept, the same code never twice,
 *    and a code whose money has not moved is never dropped
 *  - status mapping: taken back, used, not used yet, couldn't check, checking,
 *    and which rows offer Take back and Remove
 *  - the nullifier matches the one the app derives for its own notes
 *
 * Storage (sealed under the vault key) and the on-chain check need a browser.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-sent-links.mts
 */
import assert from "node:assert/strict";
import type { Address, Hex } from "viem";
import { makeBoundNotePoseidon, openNotePoseidon } from "@gloamtrade/sdk";
import {
  SENT_LINKS_MAX,
  SENT_LINK_STATUS_LABEL,
  addSentLink,
  canRemove,
  canTakeBack,
  capSentLinks,
  makeSentLink,
  needsCheck,
  parseSentLinks,
  paymentNullifier,
  sentLinkStatus,
  type SentLink,
} from "../src/lib/sentLinks";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const POOL_A = "0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740" as Address;
const POOL_B = "0x841dc046ea3cc842ba3a855731472c6eb0f2d5eb" as Address;
const ASSET = "0x0000000000000000000000000000000000000000" as Address;
const NULL = `0x${"ab".repeat(32)}` as Hex;

function code(prefix: "gloam1" | "gloam1e" | "gloam2t", n: number): string {
  return `${prefix}.${Buffer.from(`payment-${n}-${Math.random()}`).toString("base64url")}`;
}

function rec(over: Partial<Parameters<typeof makeSentLink>[0]> = {}): SentLink {
  return makeSentLink({
    code: code("gloam1", 0),
    chainId: 46630,
    pool: POOL_A,
    asset: ASSET,
    symbol: "ETH",
    amountWei: "1000000000000000",
    nullifier: NULL,
    ...over,
  });
}

await test("kind and lock follow the code; the note is cleaned", () => {
  const plain = rec({ code: code("gloam1", 1), note: "  Invoice\n042  " });
  assert.equal(plain.kind, "link");
  assert.equal(plain.locked, false);
  assert.equal(plain.note, "Invoice 042");
  assert.equal(plain.nullifier, NULL);
  assert.match(plain.id, /^sl-/);

  const locked = rec({ code: code("gloam1e", 2) });
  assert.equal(locked.kind, "link");
  assert.equal(locked.locked, true);

  const sealed = rec({ code: code("gloam2t", 3), note: "" });
  assert.equal(sealed.kind, "address");
  assert.equal(sealed.locked, false);
  assert.equal("note" in sealed, false);
});

await test("a record never carries a phrase field", () => {
  const r = rec({ code: code("gloam1e", 4) });
  assert.deepEqual(
    Object.keys(r).sort(),
    ["amountWei", "asset", "chainId", "code", "createdAt", "id", "kind", "locked", "nullifier", "pool", "symbol"].sort()
  );
});

await test("JSON round trip keeps every field", () => {
  const list = [
    rec({ code: code("gloam1", 5), note: "Rent" }),
    { ...rec({ code: code("gloam1e", 6) }), takenBackAt: 1_700_000_000_000 },
    { ...rec({ code: code("gloam2t", 7) }), usedAt: 1_700_000_000_001 },
  ];
  const back = parseSentLinks(JSON.parse(JSON.stringify(list)));
  assert.deepEqual(back, list);
});

await test("junk is dropped and kind/lock are re-derived from the code", () => {
  const good = rec({ code: code("gloam1e", 8) });
  const lying = { ...good, kind: "address", locked: false };
  const back = parseSentLinks([
    lying,
    null,
    "gloam1.abc",
    { ...good, code: "not a code" },
    { ...good, code: "gloamr1.abcdef" }, // an address is never a sent link
    { ...good, pool: "0x123" },
    { ...good, amountWei: "1.5" },
    { ...good, chainId: "46630" },
    { ...good, createdAt: -1 },
    { ...good, id: "" },
  ]);
  assert.equal(back.length, 1);
  assert.equal(back[0].kind, "link");
  assert.equal(back[0].locked, true);
  assert.deepEqual(parseSentLinks({ not: "a list" }), []);
  assert.deepEqual(parseSentLinks(null), []);
});

await test("a damaged nullifier or note is dropped, the record kept", () => {
  const r = { ...rec(), nullifier: "0x1234", note: 42 };
  const [back] = parseSentLinks([r]);
  assert.equal(back.nullifier, undefined);
  assert.equal(back.note, undefined);
});

/** A record whose money has moved (claimed and secured), so it may make room. */
const used = (r: SentLink): SentLink => ({ ...r, usedAt: r.createdAt + 1 });

await test(`cap: ${SENT_LINKS_MAX} per network and pool, newest kept`, () => {
  const base = 1_700_000_000_000;
  const a = Array.from({ length: 130 }, (_, i) => used(rec({ code: code("gloam1", 100 + i), now: base + i })));
  const b = Array.from({ length: 20 }, (_, i) => rec({ code: code("gloam1", 300 + i), pool: POOL_B, chainId: 42431, now: base + i }));
  const otherChainSamePool = Array.from({ length: 5 }, (_, i) => rec({ code: code("gloam1", 400 + i), chainId: 4663, now: base + i }));
  const capped = capSentLinks([...b, ...a, ...otherChainSamePool]);
  const inA = capped.filter((r) => r.chainId === 46630 && r.pool === POOL_A);
  assert.equal(inA.length, 100);
  assert.equal(inA[0].createdAt, base + 129); // newest first
  assert.equal(inA[99].createdAt, base + 30); // the 30 oldest dropped
  assert.equal(capped.filter((r) => r.pool === POOL_B).length, 20);
  assert.equal(capped.filter((r) => r.chainId === 4663).length, 5);
});

await test("cap never drops a code whose money has not moved", () => {
  const base = 1_700_000_000_000;
  const open = Array.from({ length: 130 }, (_, i) => rec({ code: code("gloam1", 900 + i), now: base + i }));
  assert.equal(capSentLinks(open).length, 130, "every unused code stays, even past the cap");

  // Half unused, half used or taken back: every unused one stays, the newest settled ones fill the rest.
  const mixed = Array.from({ length: 120 }, (_, i) => {
    const r = rec({ code: code("gloam1", 1100 + i), now: base + i });
    return i % 2 ? r : i % 4 ? used(r) : { ...r, takenBackAt: r.createdAt + 1 };
  });
  const kept = capSentLinks(mixed);
  assert.equal(kept.length, SENT_LINKS_MAX);
  assert.equal(kept.filter(needsCheck).length, 60);
  const settled = kept.filter((r) => !needsCheck(r));
  assert.equal(settled.length, 40);
  assert.equal(Math.min(...settled.map((r) => r.createdAt)), base + 40, "the oldest settled ones made room");
});

await test("cap treats the pool address case-insensitively", () => {
  const base = 1_700_000_000_000;
  const mixed = Array.from({ length: 101 }, (_, i) =>
    used(rec({ code: code("gloam1", 500 + i), pool: (i % 2 ? POOL_A : POOL_A.toLowerCase()) as Address, now: base + i }))
  );
  assert.equal(capSentLinks(mixed).length, 100);
});

await test("adding keeps one record per code and stays capped", () => {
  const c = code("gloam1", 600);
  let list: SentLink[] = [];
  list = addSentLink(list, rec({ code: c, now: 1 }));
  list = addSentLink(list, rec({ code: c, now: 2 }));
  assert.equal(list.length, 1);
  assert.equal(list[0].createdAt, 2);
  for (let i = 0; i < 120; i++) list = addSentLink(list, used(rec({ code: code("gloam1", 700 + i), now: 10 + i })));
  assert.equal(list.length, 100);
  assert.equal(list[0].createdAt, 129);
  assert.ok(list.some((r) => r.code === c), "the oldest record, still unused, is kept");
});

await test("status mapping", () => {
  const r = rec();
  assert.equal(sentLinkStatus(r, undefined), "checking");
  assert.equal(sentLinkStatus(r, false), "unused");
  assert.equal(sentLinkStatus(r, true), "used");
  assert.equal(sentLinkStatus(r, null), "unknown");
  assert.equal(sentLinkStatus({ ...r, usedAt: 5 }, undefined), "used");
  assert.equal(sentLinkStatus({ ...r, usedAt: 5 }, null), "used");
  // Taken back wins, even after that money later moves.
  assert.equal(sentLinkStatus({ ...r, takenBackAt: 9 }, true), "taken-back");
  assert.equal(sentLinkStatus({ ...r, takenBackAt: 9, usedAt: 10 }, false), "taken-back");

  assert.equal(SENT_LINK_STATUS_LABEL.unused, "Not used yet");
  assert.equal(SENT_LINK_STATUS_LABEL.used, "Used");
  assert.equal(SENT_LINK_STATUS_LABEL["taken-back"], "Taken back");
  assert.equal(SENT_LINK_STATUS_LABEL.unknown, "Couldn't check");
});

await test("Take back only on an unused claim link; Remove only once the money moved", () => {
  const link = rec();
  const sealed = rec({ code: code("gloam2t", 800) });
  assert.equal(canTakeBack(link, "unused"), true);
  assert.equal(canTakeBack(link, "unknown"), false);
  assert.equal(canTakeBack(link, "checking"), false);
  assert.equal(canTakeBack(link, "used"), false);
  assert.equal(canTakeBack(link, "taken-back"), false);
  assert.equal(canTakeBack(sealed, "unused"), false);

  assert.equal(canRemove("used"), true);
  assert.equal(canRemove("taken-back"), true);
  assert.equal(canRemove("unused"), false);
  assert.equal(canRemove("unknown"), false);
  assert.equal(canRemove("checking"), false);

  assert.equal(needsCheck(link), true);
  assert.equal(needsCheck({ ...link, usedAt: 1 }), false);
  assert.equal(needsCheck({ ...link, takenBackAt: 1 }), false);
});

await test("nullifier matches the app's own note derivation", async () => {
  for (const amount of [1n, 10n ** 18n, 123_456_789n]) {
    const note = await makeBoundNotePoseidon(amount, ASSET);
    assert.equal(await paymentNullifier(note.secret, note.commitment), note.nullifier);
    const opened = await openNotePoseidon(note.secret, amount, ASSET);
    assert.equal(await paymentNullifier(note.secret, opened.commitment), opened.nullifier);
  }
});

console.log(`sent links: ${passed} passed`);
