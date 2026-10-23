/**
 * Self-test: the Report-Only Content-Security-Policy (csp.config.mjs).
 *
 * connect-src must allow every RPC the browser can call: Gloam's own networks
 * and the chains a private bridge order can be paid from. A chain added to
 * lib/originChains or lib/wagmi without its host here fails this test, so the
 * policy can be enforced later without breaking a wallet.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-csp.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CSP_CONNECT_SOURCES, CSP_REPORT_ONLY } from "../csp.config.mjs";
import { ORIGIN_CHAINS } from "../src/lib/originChains";

let n = 0;
function allowed(url: string): boolean {
  const u = new URL(url);
  return CSP_CONNECT_SOURCES.some((src: string) => {
    if (src === "'self'") return false;
    const s = new URL(src.replace("*.", "wildcard."));
    if (s.protocol !== u.protocol) return false;
    if (src.includes("*.")) return u.hostname.endsWith(s.hostname.replace(/^wildcard\./, "."));
    return s.host === u.host;
  });
}

for (const c of ORIGIN_CHAINS) {
  for (const url of [...c.rpcUrls.default.http, ...(c.rpcUrls.default.webSocket ?? [])]) {
    assert.ok(allowed(url), `${c.name} RPC ${url} is in connect-src`);
    n++;
  }
}

// every transport wired in lib/wagmi
const wagmi = readFileSync(new URL("../src/lib/wagmi.ts", import.meta.url), "utf8");
for (const [, url] of wagmi.matchAll(/http\("([^"]+)"/g)) {
  assert.ok(allowed(url!), `wagmi transport ${url} is in connect-src`);
  n++;
}

// WalletConnect relay and the services read from the browser
for (const url of ["wss://relay.walletconnect.org", "https://pulse.walletconnect.org", "https://api.coingecko.com/api/v3/simple/price", "https://api.relay.link/quote"]) {
  assert.ok(allowed(url), url);
  n++;
}

// nothing that would break the app if enforced by mistake, and nothing wide open
assert.ok(CSP_REPORT_ONLY.includes("'wasm-unsafe-eval'"), "the prover's WebAssembly is allowed");
assert.ok(!/connect-src[^;]*\s(https:|wss:|\*)(\s|;|$)/.test(CSP_REPORT_ONLY), "connect-src is a list, not every https host");
assert.ok(!CSP_REPORT_ONLY.includes("report-uri"), "no report endpoint: reports go to the browser console");
n += 3;

// next.config sends it Report-Only, next to the enforced framing policy
const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
assert.ok(config.includes('key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY'));
assert.ok(/NODE_ENV === "production" \? \[\{ key: "Content-Security-Policy-Report-Only"/.test(config), "sent in production builds only");
assert.ok(config.includes("frame-ancestors 'none'"));
n += 3;

console.log(`csp: ${n} passed`);
