/** Run from app/: ../mcp/node_modules/.bin/tsx scripts/selftest-mainnet-render.mts */
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { MainnetCopy, CountdownDigits } from "../src/components/MainnetCountdown";
import { MAINNET_CONFIGURED } from "../src/lib/mainnet";

// tsx uses the classic JSX transform for this standalone script.
Object.assign(globalThis, { React });
assert.ok(MAINNET_CONFIGURED, "this regression covers the deployed mainnets");
assert.equal(renderToString(React.createElement(MainnetCopy, { live: "Live", before: "Coming soon" })), "Live");
assert.equal(renderToString(React.createElement(CountdownDigits, { onLive: "Live", onDone: "Rolling out" })), "Live");
console.log("ok: live copy and completed countdown render without browser effects");
