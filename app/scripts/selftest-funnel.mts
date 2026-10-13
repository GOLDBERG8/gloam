/**
 * Claim-link counts (lib/funnel, lib/funnelStore, /api/funnel).
 * Run from app/: ../mcp/node_modules/.bin/tsx scripts/selftest-funnel.mts
 */
import assert from "node:assert/strict";

process.env.GLOAM_PARTNERS_STORE = "memory";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

// a browser, enough for lib/funnel: local storage, sendBeacon, a non-demo host
const store = new Map<string, string>();
const beacons: string[] = [];
const g = globalThis as Record<string, unknown>;
g.window = {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  location: { hostname: "www.gloam.trade", href: "https://www.gloam.trade/app/vault" },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
Object.defineProperty(globalThis, "navigator", {
  value: {
    sendBeacon: (_u: string, b: Blob) => {
      void b.text().then((t) => beacons.push(JSON.parse(t).e));
      return true;
    },
  },
  configurable: true,
});

const { POST } = await import("../src/app/api/funnel/route");
const { readFunnel, sumFunnel } = await import("../src/lib/funnelStore");
const f = await import("../src/lib/funnel");

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}
const post = (body: string) => POST(new Request("https://www.gloam.trade/api/funnel", { method: "POST", body, headers: { "x-forwarded-for": "203.0.113.9" } }));
const flush = () => new Promise((r) => setTimeout(r, 10));

await test("the endpoint takes one known event and nothing else", async () => {
  assert.equal((await post(JSON.stringify({ e: "link_created" }))).status, 204);
  assert.equal((await post(JSON.stringify({ e: "link_claimed" }))).status, 204);
  assert.equal((await post(JSON.stringify({ e: "page_view" }))).status, 400);
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post(JSON.stringify({ e: "link_opened", pad: "x".repeat(300) }))).status, 413);
  const t = sumFunnel(await readFunnel(1));
  assert.deepEqual(t, { link_created: 1, link_opened: 0, link_claimed: 1, claimer_sent: 0 });
});

await test("only plain claim links count, and opening the same one twice counts once", async () => {
  beacons.length = 0;
  const code = "gloam1.eyJ2IjoxLCJzIjoiMHhhYmMifQ";
  f.countLinkOpened(code);
  f.countLinkOpened(code);
  f.countLinkOpened("gloam2t.sealedTicketForSomeone");
  f.countLinkOpened("gloamr1.someonesAddress");
  await flush();
  assert.deepEqual(beacons, ["link_opened"]);
  assert.ok(!JSON.stringify([...store.values()]).includes(code), "the code itself is never stored");
});

await test("a claimer's first own payment counts once, and only after a claim", async () => {
  beacons.length = 0;
  f.countSendAfterClaim();
  await flush();
  assert.deepEqual(beacons, [], "no claim yet");
  f.countLinkClaimed("gloam1e.lockedCodeHere");
  f.countSendAfterClaim();
  f.countSendAfterClaim();
  await flush();
  assert.deepEqual(beacons, ["link_claimed", "claimer_sent"]);
});

console.log(`\nfunnel: ${passed} passed`);
