/**
 * SDK self-test: mainnet networks, key sets, circuit files, fees and limits.
 *
 * Runs against whatever MAINNET_POOLS holds. Before deploy day both pools are
 * null, so mainnet is hidden and mainnet chain ids are refused; once a pool is
 * filled in, its network must show up with the final keys and payments only.
 *
 * Run after build:  node test/mainnet.selftest.mjs
 */
import {
  MAINNET_POOLS,
  mainnetPoolFor,
  mainnetNetwork,
  gloamNetworks,
  getGloamNetwork,
  networkForChainId,
  poolForChainId,
  ceremonyForChainId,
  isMainnetChainId,
  networkName,
  circuitArtifactUrls,
  circuitArtifactFiles,
  CIRCUIT_SHA256,
  cashOutFee,
  CASH_OUT_FEE_BPS,
  assertDepositAllowed,
  buildShieldBoundIntent,
  buildPrivateTradeIntent,
  buildGloamPaymentRequirements,
  GLOAM_NETWORKS,
  GLOAM_TESTNETS,
  SEALED_VAULT,
  TEMPO_SEALED_VAULT,
  NATIVE_ASSET,
  RH_MAINNET_USDG,
  GLOAM_TOKEN,
  TEMPO_USDCE,
  TEMPO_USDT0,
  TEMPO_PATHUSD,
  TEMPO_OUSD,
  RH_MAINNET_CHAIN_ID,
  TEMPO_MAINNET_CHAIN_ID,
  RH_TESTNET_CHAIN_ID,
  TEMPO_TESTNET_CHAIN_ID,
  MAINNET_POSEIDON_T3,
  generateReceiveKey,
} from "../dist/index.js";

let checks = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  checks++;
}
async function throwsAsync(fn, re, msg) {
  try {
    await fn();
  } catch (e) {
    assert(re.test(String(e?.message ?? e)), `${msg}: wrong error "${e?.message}"`);
    return;
  }
  assert(false, `${msg}: did not throw`);
}
function throws(fn, re, msg) {
  try {
    fn();
  } catch (e) {
    assert(re.test(String(e?.message ?? e)), `${msg}: wrong error "${e?.message}"`);
    return;
  }
  assert(false, `${msg}: did not throw`);
}

// ── testnets unchanged ─────────────────────────────────────────────────────────
assert(GLOAM_TESTNETS === GLOAM_NETWORKS, "GLOAM_TESTNETS aliases GLOAM_NETWORKS");
assert(GLOAM_NETWORKS.robinhood.chainId === RH_TESTNET_CHAIN_ID && GLOAM_NETWORKS.robinhood.pool === SEALED_VAULT, "RH testnet entry");
assert(GLOAM_NETWORKS.tempo.chainId === TEMPO_TESTNET_CHAIN_ID && GLOAM_NETWORKS.tempo.pool === TEMPO_SEALED_VAULT, "Tempo testnet entry");
for (const n of Object.values(GLOAM_NETWORKS)) {
  assert(n.testnet === true && n.ceremony === "dev" && n.payMemo, `${n.key} is a dev-key testnet with a memo board`);
  assert(n.chain.id === n.chainId, `${n.key} viem chain id`);
}
assert(networkForChainId(RH_TESTNET_CHAIN_ID)?.key === "robinhood", "testnet lookup by chain id");

// ── key sets and circuit files ─────────────────────────────────────────────────
assert(isMainnetChainId(4663) && isMainnetChainId(4217) && !isMainnetChainId(46630) && !isMainnetChainId(42431), "mainnet chain ids");
assert(ceremonyForChainId(RH_MAINNET_CHAIN_ID) === "production", "RH mainnet proves with final keys");
assert(ceremonyForChainId(TEMPO_MAINNET_CHAIN_ID) === "production", "Tempo mainnet proves with final keys");
assert(ceremonyForChainId(RH_TESTNET_CHAIN_ID) === "dev" && ceremonyForChainId(TEMPO_TESTNET_CHAIN_ID) === "dev", "testnets prove with dev keys");

const tMain = circuitArtifactUrls("transfer", TEMPO_MAINNET_CHAIN_ID);
assert(tMain.wasm === "https://www.gloam.trade/circuits/transfer.wasm", "mainnet wasm url");
assert(tMain.zkey === "https://www.gloam.trade/circuits/final/transfer_final.zkey", "mainnet zkey is the final key");
const sTest = circuitArtifactUrls("shield", RH_TESTNET_CHAIN_ID, "/circuits/");
assert(sTest.wasm === "/circuits/shield.wasm" && sTest.zkey === "/circuits/shield_final.zkey", "testnet files, custom base");
const fFinal = circuitArtifactFiles("unshield", "production");
assert(fFinal.sha256.zkey === CIRCUIT_SHA256.zkey.production.unshield && fFinal.sha256.zkey !== CIRCUIT_SHA256.zkey.dev.unshield, "final and dev zkeys differ");
for (const set of [CIRCUIT_SHA256.wasm, CIRCUIT_SHA256.zkey.dev, CIRCUIT_SHA256.zkey.production]) {
  for (const h of Object.values(set)) assert(/^[0-9a-f]{64}$/.test(h), "sha256 is 64 hex chars");
}

// ── fees ────────────────────────────────────────────────────────────────────────
assert(CASH_OUT_FEE_BPS === 25, "0.25% cash-out fee");
assert(cashOutFee(100_000_000n) === 250_000n, "0.25% of 100 USDC.e is 0.25");
assert(cashOutFee(399n) === 0n, "rounds down in the user's favour");
assert(cashOutFee(10_001n, 25) === 25n, "matches the contract's split formula");
assert(cashOutFee(1_000n, 0) === 0n, "fee off");
throws(() => cashOutFee(-1n), /negative/, "negative amount");

// ── names ───────────────────────────────────────────────────────────────────────
assert(networkName(4663) === "Robinhood Chain" && networkName(4217) === "Tempo", "mainnet names");
assert(networkName(46630) === "Robinhood Chain testnet" && networkName(42431) === "Tempo testnet", "testnet names");
assert(MAINNET_POSEIDON_T3 === "0x1a32C2c2A77225EC2dD3BF7be1018819b1039Cb4", "PoseidonT3");

// ── MAINNET_POOLS validation ─────────────────────────────────────────────────────
{
  const saved = { ...MAINNET_POOLS[4663] };
  MAINNET_POOLS[4663] = { pool: "0x1234", deployBlock: 5n };
  throws(() => mainnetPoolFor(4663), /not a pool address/, "a bad pool address throws");
  MAINNET_POOLS[4663] = { pool: "0x0000000000000000000000000000000000000000", deployBlock: 5n };
  throws(() => mainnetPoolFor(4663), /not a pool address/, "the zero address throws");
  MAINNET_POOLS[4663] = { pool: "0x00000000000000000000000000000000000000aa", deployBlock: 0n };
  throws(() => mainnetPoolFor(4663), /deploy block/, "block 0 throws");
  MAINNET_POOLS[4663] = { pool: "0x00000000000000000000000000000000000000aa", deployBlock: 7n };
  assert(mainnetPoolFor(4663)?.deployBlock === 7n, "a good entry resolves");
  MAINNET_POOLS[4663] = saved;
}

// ── mainnet networks, as filled in ───────────────────────────────────────────────
const prover = async () => ({ proofBytes: "0x" + "ab".repeat(256), publicSignals: [] });
const live = gloamNetworks();
assert(live.slice(-2).map((n) => n.key).join() === "robinhood,tempo", "testnets come last");

for (const [family, chainId, key, assets] of [
  ["robinhood", RH_MAINNET_CHAIN_ID, "robinhood-mainnet", [RH_MAINNET_USDG, GLOAM_TOKEN]],
  ["tempo", TEMPO_MAINNET_CHAIN_ID, "tempo-mainnet", [TEMPO_USDCE, TEMPO_PATHUSD, TEMPO_USDT0, TEMPO_OUSD]],
]) {
  const filled = mainnetPoolFor(chainId);
  const net = mainnetNetwork(family);
  if (!filled) {
    // Before deploy day: hidden, and refused rather than guessed.
    assert(net === null && getGloamNetwork(key) === null && networkForChainId(chainId) === undefined, `${key} hidden until its pool is in`);
    throws(() => poolForChainId(chainId), /not in this version/, `${key}: no pool guessed`);
    await throwsAsync(
      () => buildShieldBoundIntent({ chainId, asset: assets[0], amountWei: 1_000_000n, prover }),
      /not in this version/,
      `${key}: builder refuses a mainnet without a pool`
    );
    continue;
  }
  assert(net && net.key === key && net.chainId === chainId && net.pool === filled.pool && net.deployBlock === filled.deployBlock, `${key} entry`);
  assert(net.testnet === false && net.ceremony === "production" && net.nativeShield === false && net.payMemo === null, `${key}: real money, final keys, no native, no memo board`);
  assert(net.assets.map((a) => a.address).join() === assets.join(), `${key} assets`);
  assert(live[0].testnet === false, "mainnets come first");
  assert(poolForChainId(chainId) === filled.pool, `${key} pool by chain id`);
  // Deposits: listed assets only, within the beta per-deposit limit, never native.
  const usd = net.assets[0];
  assertDepositAllowed(chainId, usd.address, usd.depositLimit.perDeposit);
  throws(() => assertDepositAllowed(chainId, usd.address, usd.depositLimit.perDeposit + 1n), /beta limit/, `${key}: over the per-deposit limit`);
  throws(() => assertDepositAllowed(chainId, NATIVE_ASSET, 1n), /no native deposits/, `${key}: native refused`);
  throws(() => assertDepositAllowed(chainId, "0x00000000000000000000000000000000000000bb", 1n), /does not list/, `${key}: unlisted asset refused`);
  const intent = await buildShieldBoundIntent({ chainId, asset: usd.address, amountWei: usd.depositLimit.perDeposit, prover });
  assert(intent.exec.poolAddress === filled.pool && intent.chainId === chainId, `${key}: shield targets the mainnet pool`);
  await throwsAsync(
    () => buildPrivateTradeIntent({ chainId, secretHex: "0x01", amountInWei: 1n, amountSwapWei: 1n, assetOut: usd.address, amountOutMinWei: 1n, rateIn: 1n, rateOut: 1n, path: {}, prove: prover }),
    /payments only/,
    `${key}: no private trading`
  );
}

// ── limits per asset ──────────────────────────────────────────────────────────────
// Checked on the asset tables directly, so they hold before the pools are in too.
{
  const { RH_MAINNET_ASSETS, TEMPO_MAINNET_ASSETS } = await import("../dist/index.js");
  for (const a of [...TEMPO_MAINNET_ASSETS, RH_MAINNET_ASSETS[0]]) {
    assert(a.decimals === 6 && a.depositLimit.perDeposit === 500_000_000n && a.depositLimit.total === 25_000_000_000n, `${a.symbol}: 500 per deposit, 25,000 total`);
  }
  const g = RH_MAINNET_ASSETS[1];
  assert(g.symbol === "GLOAM" && g.decimals === 18 && g.depositLimit.perDeposit === 25_000n * 10n ** 18n && g.depositLimit.total === 250_000n * 10n ** 18n, "GLOAM: 25,000 per deposit, 250,000 total");
}

// ── x402 requirements resolve the pool from the network ─────────────────────────
{
  const payee = await generateReceiveKey();
  const req = buildGloamPaymentRequirements({ amountWei: 10n, asset: TEMPO_PATHUSD, payTo: payee.tag, resource: "r", network: TEMPO_TESTNET_CHAIN_ID });
  assert(req.poolAddress === TEMPO_SEALED_VAULT, "requirements on Tempo testnet name the Tempo pool");
  if (!mainnetPoolFor(TEMPO_MAINNET_CHAIN_ID)) {
    throws(
      () => buildGloamPaymentRequirements({ amountWei: 10n, asset: TEMPO_USDCE, payTo: payee.tag, resource: "r", network: TEMPO_MAINNET_CHAIN_ID }),
      /not in this version/,
      "requirements refuse a mainnet without a pool"
    );
  }
}

console.log(`mainnet selftest: ${checks} checks passed`);
