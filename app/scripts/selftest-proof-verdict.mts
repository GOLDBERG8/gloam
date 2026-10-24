/** Run from app/: ../mcp/node_modules/.bin/tsx scripts/selftest-proof-verdict.mts */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { amountOf, ProofVerdict } from "../src/components/verify/ProofVerdict";
import type { BalanceProof, VerifyResult } from "../src/lib/proofs/types";

Object.assign(globalThis, { React });
const asset = "0xDcD885F5c60b3aD49F6D58718696417314e8724d";
assert.equal(amountOf("1", asset), "0.000000000000000001");
assert.equal(amountOf("600000000000", asset), "0.0000006");
assert.equal(amountOf("9007199254740993123456789012345678", asset), "9,007,199,254,740,993.123456789012345678");
assert.equal(amountOf("1000001", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"), "1.000001");
const proof: BalanceProof = { v: 1, kind: "balance", chainId: 4663, pool: "0x39e28cde55cab798874746ac52cb4b5cc99a0194", asset, verifier: "Test", expiresAt: 1793000000, amount: "1", commitment: `0x${"01".repeat(32)}`, publicSignals: [], proof: {} };
const render = (result: VerifyResult) => renderToStaticMarkup(React.createElement(ProofVerdict, { proof, result, checkedAt: 1793100000 }));
const expired: VerifyResult = { kind: "balance", ok: false, expired: true, checks: [
  { label: "The proof checks out", state: "pass" },
  { label: "Balance is in the vault", state: "unknown", detail: "Could not reach the network." },
  { label: "Expired", state: "fail" },
] };
const incomplete = render(expired);
assert.match(incomplete, /This proof can&#x27;t be confirmed/);
assert.match(incomplete, /Could not reach the network/);
assert.doesNotMatch(incomplete, /This proof checked out, but/);
assert.match(incomplete, />Expired</);
assert.match(render({ ...expired, checks: expired.checks.filter(c => c.state !== "unknown") }), /This proof checked out, but/);
assert.match(render({ ...expired, checks: [...expired.checks, { label: "Bad proof", state: "fail" }] }), /This proof did not check out/);
assert.match(render({ kind: "balance", ok: true, expired: false, checks: [{ label: "Passed", state: "pass" }] }), /A private balance of exactly 0.000000000000000001 /);
console.log("ok: exact amounts and verified, failed, incomplete, expired verdicts");
