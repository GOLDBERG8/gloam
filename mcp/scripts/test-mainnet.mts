/**
 * Mainnet tests: which networks this build offers, how a mainnet is named in
 * limits, that a testnet config never approves real money by itself, the key
 * set each network proves with, and that a price on a chain this build has no
 * pool for is refused.
 *
 *   pnpm --filter @gloamtrade/mcp test
 *
 * Nothing here touches a chain. Mainnet pools come from the SDK's MAINNET_POOLS;
 * before deploy day they are null, and these tests cover that state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUnits, type Address } from "viem";
import {
  GLOAM_NETWORKS,
  GLOAM_TOKEN,
  RH_MAINNET_USDG,
  RH_USDG,
  TEMPO_PATHUSD,
  TEMPO_USDCE,
  circuitArtifactFiles,
  mainnetPoolFor,
} from "@gloamtrade/sdk";
import { checkSpend, loadPolicy, resolveAgent, type Spend } from "../src/policy.js";
import { MCP_MAINNETS, MCP_NETWORKS, NETWORK_KEYS, allNetworks, defaultNetworkKey, networkByChainId, tempoAccessNetwork } from "../src/networks.js";
import { parseFlags } from "../src/cli.js";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = Date.parse("2026-10-21T14:00:00Z");
const PAYEE = "gloamr1.payee-tag-for-tests";

const spend = (over: Partial<Spend>): Spend => ({
  tool: "pay",
  network: "robinhood-mainnet",
  chainId: 4663,
  asset: RH_MAINNET_USDG,
  amountWei: parseUnits("1", 6),
  recipient: PAYEE,
  ...over,
});

test("networks: testnets always; a mainnet only once the SDK has its pool", () => {
  const rhLive = mainnetPoolFor(4663) !== null;
  const tempoLive = mainnetPoolFor(4217) !== null;
  assert.equal(MCP_MAINNETS.length, Number(rhLive) + Number(tempoLive));
  assert.deepEqual(NETWORK_KEYS.slice(-2), ["robinhood", "tempo"]);
  assert.equal(NETWORK_KEYS.includes("robinhood-mainnet"), rhLive);
  assert.equal(NETWORK_KEYS.includes("tempo-mainnet"), tempoLive);
  for (const n of allNetworks()) {
    assert.equal(n.ceremony, n.testnet ? "dev" : "production", `${n.key} proves with the right keys`);
    if (!n.testnet) {
      assert.equal(n.nativeShield, false, `${n.key}: no native deposits on mainnet`);
      assert.notEqual(n.defaultAsset, "0x0000000000000000000000000000000000000000");
    }
  }
  assert.equal(MCP_NETWORKS.tempo.chainId, GLOAM_NETWORKS.tempo.chainId);
  if (!rhLive) assert.equal(networkByChainId(4663), undefined, "no pool, no network");
});

test("GLOAM_NETWORK picks the default network, and a missing or wrong one fails loudly", () => {
  assert.equal(defaultNetworkKey({}), "robinhood");
  assert.equal(defaultNetworkKey({ GLOAM_NETWORK: "tempo" }), "tempo");
  assert.throws(() => defaultNetworkKey({ GLOAM_NETWORK: "mainnet" }), /not a Gloam network/);
  if (mainnetPoolFor(4217) === null) {
    assert.throws(() => defaultNetworkKey({ GLOAM_NETWORK: "tempo-mainnet" }), /no tempo-mainnet pool yet/);
  } else {
    assert.equal(defaultNetworkKey({ GLOAM_NETWORK: "tempo-mainnet" }), "tempo-mainnet");
    assert.equal(tempoAccessNetwork({ GLOAM_NETWORK: "tempo-mainnet" }).chainId, 4217);
  }
  assert.equal(tempoAccessNetwork({}).chainId, GLOAM_NETWORKS.tempo.chainId, "access keys default to Tempo testnet");
});

test("mainnet proofs use the final keys, kept apart from the dev keys", () => {
  const dev = circuitArtifactFiles("transfer", "dev");
  const fin = circuitArtifactFiles("transfer", "production");
  assert.equal(dev.zkey, "transfer_final.zkey");
  assert.equal(fin.zkey, "final/transfer_final.zkey");
  assert.equal(dev.wasm, fin.wasm, "one wasm for both key sets");
  assert.notEqual(dev.sha256.zkey, fin.sha256.zkey);
});

test("a testnet limits config never approves real money by itself", () => {
  // "USDG" alone is the testnet USDG.
  const testnetOnly = resolveAgent("bot", { recipients: "any", maxPerPayment: "5", maxPerDay: "10", assets: ["USDG"] }, "test");
  assert.equal(testnetOnly.assets[0]!.address, RH_USDG);
  assert.equal(testnetOnly.assets[0]!.chainId, GLOAM_NETWORKS.robinhood.chainId);
  const r = checkSpend(testnetOnly, spend({}), [], NOW);
  assert.equal(r?.code, "asset_not_allowed");
  assert.match(r!.message, /USDG on Robinhood Chain is not one of this agent's assets/);
  // pathUSD shares its address on both Tempo networks: an address alone means the testnet too.
  const byAddress = resolveAgent("bot", { recipients: "any", maxPerPayment: "5", maxPerDay: "10", assets: [TEMPO_PATHUSD] }, "test");
  assert.equal(byAddress.assets[0]!.chainId, GLOAM_NETWORKS.tempo.chainId);
  assert.equal(checkSpend(byAddress, spend({ network: "tempo-mainnet", chainId: 4217, asset: TEMPO_PATHUSD }), [], NOW)?.code, "asset_not_allowed");
});

test("naming a mainnet network in limits allows exactly that asset there", () => {
  const p = resolveAgent(
    "bot",
    {
      recipients: [PAYEE],
      assets: {
        USDG: { network: "robinhood-mainnet", maxPerPayment: "5", maxPerDay: "10" },
        pathUSD: { network: "tempo-mainnet", maxPerPayment: "2", maxPerDay: "4" },
        "USDC.e": { maxPerPayment: "3", maxPerDay: "6" },
        GLOAM: { maxPerPayment: "100", maxPerDay: "100" },
      },
    },
    "test"
  );
  const [usdg, path, usdce, gloam] = p.assets;
  assert.deepEqual([usdg!.address, usdg!.chainId, usdg!.decimals], [RH_MAINNET_USDG, 4663, 6]);
  assert.deepEqual([path!.address, path!.chainId], [TEMPO_PATHUSD, 4217]);
  assert.deepEqual([usdce!.address, usdce!.chainId], [TEMPO_USDCE, 4217], "USDC.e is mainnet only");
  assert.deepEqual([gloam!.address, gloam!.chainId, gloam!.decimals], [GLOAM_TOKEN, 4663, 18]);
  assert.equal(checkSpend(p, spend({}), [], NOW), null);
  assert.equal(checkSpend(p, spend({ amountWei: parseUnits("6", 6) }), [], NOW)?.code, "over_per_payment");
  // The mainnet entry does not open the testnet asset of the same name.
  assert.equal(checkSpend(p, spend({ network: "robinhood", chainId: GLOAM_NETWORKS.robinhood.chainId, asset: RH_USDG }), [], NOW)?.code, "asset_not_allowed");
  assert.equal(checkSpend(p, spend({ network: "tempo", chainId: GLOAM_NETWORKS.tempo.chainId, asset: TEMPO_PATHUSD }), [], NOW)?.code, "asset_not_allowed");
});

test("GLOAM_LIMIT_NETWORK names the network of inline limits", () => {
  const dir = mkdtempSync(join(tmpdir(), "gloam-mainnet-"));
  writeFileSync(join(dir, "x"), "");
  const base = { GLOAM_LIMIT_ASSETS: "pathUSD,USDC.e", GLOAM_LIMIT_MAX_PER_PAYMENT: "5", GLOAM_LIMIT_MAX_PER_DAY: "10", GLOAM_LIMIT_RECIPIENTS: "any" };
  const mainnet = loadPolicy({ ...base, GLOAM_LIMIT_NETWORK: "tempo-mainnet" }, read);
  assert.equal(mainnet.mode, "enforced");
  if (mainnet.mode === "enforced") assert.deepEqual(mainnet.policy.assets.map((a) => a.chainId), [4217, 4217]);
  const bad = loadPolicy({ ...base, GLOAM_LIMIT_NETWORK: "mainnet" }, read);
  assert.equal(bad.mode, "invalid");
  // USDC.e does not exist on the testnet, so naming the testnet for it fails closed.
  const wrong = loadPolicy({ ...base, GLOAM_LIMIT_NETWORK: "tempo" }, read);
  assert.equal(wrong.mode, "invalid");
});

test("authorize-access-key takes --network", () => {
  assert.equal(parseFlags(["--network", "tempo-mainnet", "--owner", "0x1"]).network, "tempo-mainnet");
  assert.equal(parseFlags(["--network=tempo"]).network, "tempo");
});
