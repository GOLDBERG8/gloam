# Production gate (contracts + circuits)

Testnet Poseidon pools are live with **dev ceremony** keys, as the free practice
network. The mainnet deploy uses the multi-party ceremony's final keys and checks them
on chain. Mainnet launches Wednesday 21 October 2026, 13:00 UTC, as a beta with
deposit limits, on Robinhood Chain (`4663`) and Tempo (`4217`).

## 1. Ceremony

- [x] Public Powers of Tau (Hermez `powersOfTau28_hez_final_16.ptau`, blake2b checked)
- [x] Circuit-specific multi-party contribution for all six mainnet circuits (13 contributors)
- [x] Transcript published (`ceremony/TRANSCRIPT.md`, release `ceremony-final`, beacon drand 6561386)
- [x] Final `*_final.zkey` each re-verified against its r1cs and the ptau (`snarkjs zkey verify`: ZKey Ok)
- [x] Solidity verifiers exported from them: `src/verifiers/final` (byte for byte, renamed `*Final`)
- [x] App side: `app/public/circuits/final`, hash-pinned in `circuitArtifacts.ts` and
      `proofs/artifacts.ts`; each network proves with its own set (`GloamNetwork.ceremony`)
- [x] Key gate: `script/KeyCheckProofs.sol` holds real proofs made with both key sets
      (`node circuits/scripts/gen-key-fixtures.mjs`); `test/KeyCheck.t.sol` shows each
      verifier set accepts only its own

## 2. Deploy

- [x] PoseidonT3 deployed on both mainnets at `0x1a32C2c2A77225EC2dD3BF7be1018819b1039Cb4`
      (Robinhood Chain `4663` and Tempo `4217`): the `POSEIDON2` both deploy scripts take
- [x] `ShieldPoolPayments` (payments only, no sealed swap) on each chain:
      `script/DeployTempoMainnet.s.sol` (4217) and `script/DeployRobinhoodMainnet.s.sol`
      (4663), both running the shared `script/MainnetDeploy.sol`. It deploys the final
      verifiers and **creates no pool unless they accept the final-key proofs and reject
      the dev-key ones**. The pool estimates about 24.9M gas on Tempo with the cash-out
      fee (30M cap; keep `--gas-estimate-multiplier` at or under 120); Robinhood
      Chain has no special cap. USDG on Robinhood Chain is `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- [x] The pool can't take a plain `shield()` (deposits need `shieldBound()`), and
      `endSetup()` reverts until both verifiers are set and deposit limits are on
- [x] Beta deposit limits on: each listed asset gets a per-deposit and a
      total limit; an unlisted asset cannot be deposited. Robinhood Chain lists
      USDG and GLOAM (`0xDcD885F5c60b3aD49F6D58718696417314e8724d`, 18 decimals,
      25,000 per deposit, 250,000 total) so holders can vote privately; Tempo lists
      USDC.e, pathUSD, USDT0 and OUSD. Each stablecoin: 500 per deposit, 25,000 total
- [x] Emergency path: `lowerDepositLimit(asset, 0, 0)` closes deposits at once
      (no timelock); withdrawals and private transfers keep working. Raising a
      limit or listing an asset takes the 3-day timelock
- [x] Transfer ownership to a multisig (`NEW_OWNER`, then `acceptOwnership()`). The
      script refuses a `NEW_OWNER` with no code unless `NEW_OWNER_EOA=1`. At launch the
      owner and treasury is one wallet (`0x76b7E410a227c888aBD2Bdc24Ee32E094B0FD4D8`);
      the multisig is planned. Deployed 21 Oct 2026 on both chains (pool
      `0x39e28cde55cab798874746ac52cb4b5cc99a0194`); that wallet accepted ownership on both the same morning
- [x] After the broadcast the script reads every setting back and fails on a mismatch:
      deposit limits on, setup ended, shield verifier and spend verifier as deployed, fee
      at most 1%, and the key gate again on the pool's own verifiers. If it fails, do
      not announce the pool; deploy a fresh one
- [x] Keep the deposit list to the native coin and vetted fixed-supply stablecoins (plus
      $GLOAM): a rebasing, freezable or fee-on-transfer token only harms its own asset,
      but it can stall that asset
- [x] Record addresses in `deployments/mainnet.json` (or chain-specific)
- [x] App: the mainnet entries in `app/src/lib/networks.ts` (`ceremony: "production"`)
      and the mainnet token lists in `tokens.ts`, hidden until their pool is filled in
- [x] Fill in each pool and its deploy block: `MAINNET_POOLS` in `app/src/lib/mainnet.ts`
      and in the SDK (Robinhood Chain `0x39e28cde55cab798874746ac52cb4b5cc99a0194` at `94194599`, Tempo
      `0x39e28cde55cab798874746ac52cb4b5cc99a0194` at `45172561`), and set `GLOAM_RPC_URL_4663` /
      `GLOAM_RPC_URL_4217` to a private RPC for the server (the RPC env is still to do; the public
      RPCs are the fallback)

## 3. Review

- [x] Internal pre-mainnet review, 20 Oct 2026 (six-part review of the mainnet
      code): no Critical or High in the contracts. Fixed: dev keys (GATE 2), deploy-window
      unbound deposit (F1), soft post-deploy checks (F3), multisig check (F2), duplicate
      spend gas (R-1), inbox spoofing (NEW-1), passphrase KDF
- [ ] Independent external review of pool, verifiers, circuits
- [x] Fix critical/high findings from the internal review
- [ ] Threat model sign-off (anonymity set, owner keys, note custody)

## 4. Ops

- [ ] Incident contact + disclosure process
- [ ] Monitoring (pool balance, root, verifier, pause if any)
- [ ] No always-true mock verifier on funded pool (ever)

## Explicit non-claims

- No external audit yet: reviewed internally, an external audit is planned
- Beta software handling real money: deposit limits on, one owner wallet until the multisig
- Private trading is not on mainnet (`ShieldPoolPayments` has no swap code)
- Dev zkeys must not be used for real money
