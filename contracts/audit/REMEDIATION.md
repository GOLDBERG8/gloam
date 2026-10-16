# Gloam: Audit Remediation Status

Tracks the fixes for the findings in `GLOAM-BUG-REPORT.md` and the second pass
below. Both audits are internal (self-run Kensho passes, then owner-verified);
there has been no external audit yet. "Fixed" here means verified, not asserted.

Last re-verified against live on-chain state and current code on **2026-10-10**.
Earlier sections are kept as a log; pool addresses in them are marked where they
have since been superseded.

## Status at a glance (2026-10-10)

| ID | Severity | Status |
|----|----------|--------|
| H-P1 | Critical | **FIXED (verified on-chain)**: old pool drained, de-published, seed guard |
| C1 | High | **FIXED (verified on-chain)**: `shieldVerifier` set on both current pools; plain `shield()` reverts, deposits go through `shieldBound()` |
| H1 | High | **MITIGATED (verified on-chain)**: `sealedSwapVerifier` is `0x0` on both current pools, so swaps are off; safe re-enable needs the H1 accounting redesign and an audit |
| M-4 | Medium | **FIXED and live** since the 2026-09-29 redeploy: one-way shield verifier, two-step owner, `emergencyWithdraw` removed, every rule change behind a 3-day public timelock. Residual: the owner is a single wallet |
| M-3 | Medium | **Partially fixed**: SDK clamp bug fixed + on-chain oracle ratio-tolerance added; full user-set slippage UI is future |
| L-1 | Low | **FIXED on Tempo, relay-only on Robinhood Chain**: the Tempo memo board is deployed from the fixed source (no poster). The Robinhood Chain board `0x689e…5DCE` is the first deploy and still indexes the poster, so the sender stays off it only when the Gloam relay posts the memo |
| M-1 | Medium | **Fixed**: note secrets, payroll runs and schedules, and the receive key are encrypted at rest in `noteVault`, under a non-extractable AES-GCM device key or a passkey PRF wrap. Receive keys stored as plain JSON by earlier versions are sealed on first read |
| M-2 | Medium | **Open (mainnet gate)**: single-contributor dev-ceremony zkeys, disclosed in docs |

**Honest headline:** every critical/high is fixed and verified (H-P1, C1), or
switched off and verified (H1). M-4 is fixed on-chain apart from the single-wallet
owner. M-1 is fixed, M-3 is partly closed, M-2 is an open mainnet-gate item. Do
not say "all findings fixed"; say "all critical/high fixed or switched off and
verified; M-1 fixed; M-3 partial; M-2 and the multi-party ceremony tracked for
mainnet."

**2026-10-11:** two more internal passes (Kensho + a ZK review). See
"2026-10-11 audits" at the bottom. One of them (ZK-1) shows that the 128-bit
rate checks claimed below do not close the sealed swap product wrap, so sealed
swap now needs the ZK-1 fix as well as H1 before it can come back on.

## Current pools (verified on-chain 2026-10-10)

Redeployed 2026-09-29 with no admin withdraw. Read back on both:

- Robinhood Chain `46630`, pool `0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740`:
  `verifier` = `0xB077…f7eF`, `shieldVerifier` = `0x28E6…2847`,
  `sealedSwapVerifier` = `0x0`, `setupMode` = `false`, `CHANGE_DELAY` = 3 days.
  Memo board `0x689ebd9d30E0235c73fd8f10236F850CDB3c5DCE` (indexes the poster).
- Tempo `42431`, pool `0x841DC046Ea3CC842BA3A855731472c6Eb0F2d5eb`:
  `verifier` = `0x82F4…03A2`, `shieldVerifier` = `0x7836…6Eb3`,
  `sealedSwapVerifier` = `0x0`, `setupMode` = `false`, `CHANGE_DELAY` = 3 days.
  Memo board `0x3ca88712e9219b5EE4c82D31cAfEaB64C9E9b4E3` (no poster).
- Owner on both: `0x7dB5…35a9`, a single wallet (no contract code).

The owner cannot withdraw pooled funds. It can still change the dual verifier,
the sealed-swap verifier, rates and oracle config, but only by queueing the
change on-chain and waiting the public 3-day delay. The shield verifier is
one-way and cannot be changed once set.

Superseded pools (history only): Robinhood Chain `0xAc25…aF1c` (2026-09-16) and
`0xaEbB…1834` (2026-09-01); Tempo `0xeD0b…2276` (2026-09-16) and `0x3eee…d30b`.

Contract tests: 93/93 green (`forge test`, 2026-10-10).

---

## First pass: verified on-chain (2026-09-01, chainId 46630)

The owner ran the recovery + hardening. Read back and confirmed:

- Old pool `0x4F38…12D8F`: ETH 0, `deposited[TSLA/AMZN/AMD]` all 0. Drained.
- App pool `0xaEbB…1834` (superseded 2026-09-16): `owner` = `0x8F47…026B6`
  (rotated off the burned key), `shieldVerifier` = `0x28E6…2847` (C1 enforced,
  plain shield() reverts), `sealedSwapVerifier` = `0x0` (H1 swaps disabled).

## Fixed in code (live on `main`)

- **C1 client flow** (`171680a`): `ShieldView` reads `shieldVerifier` and, when
  set, proves `commitment == Poseidon(secret, amount, asset)` and deposits via
  `shieldBound()`. Validated offline; the deployed app has it.
- **H-P1 hygiene** (`cc1f630`): seed script guarded (refuses `shieldVerifier==0`)
  and repointed; 0x4F38 removed from public docs/scripts.
- **Stale artifact hashes** (`c1b3c5b`): repinned so proving works.
- **H1 graceful fallback** (`d78d5d8`): a real `sealedSwapVerifier==0` now reports
  "private trade offline" instead of letting a swap revert on-chain.
- **M-3 slippage gate** (`c3cf4b7`): the SDK no longer clamps a user's minimum
  down to `amountOut`. The public floor (privacy, ~1 wei) is separated from a new
  client-side `minOut` gate that refuses to build below the user's real minimum.
- **M-1 notes at rest**: `app/src/lib/noteVault.ts` keeps notes in memory and
  persists them AES-GCM encrypted, under a non-extractable device key in
  IndexedDB or a data key wrapped by a passkey PRF (`passkeyWrap.ts`). Payroll
  runs and schedules are sealed under the same key, and so is the receive key
  (`receiveTag.ts`): plain JSON keys from earlier versions are sealed on first
  read, and turning a passkey on or off reseals them with the notes.

## Landed at the hardened redeploys (2026-09-16, carried into 2026-09-29)

At the time of the first pass these were code-ready but not live, because pool
`0xaEbB` predated them. They are now on-chain in the current pools.

- **M-4** (`e2059e9`): `setShieldVerifier` is one-way (can't be reset to reopen
  C1); ownership is two-step (`pendingOwner` + `acceptOwnership`). The
  2026-09-29 redeploy (`09d454d`) also removed `emergencyWithdraw` and put every
  rule change behind `ChangeTimelock` (3-day delay).
- **M3 oracle rates** (`7f710c0`): `sealedSwap` can bind a direction to live
  Chainlink feeds (`OracleRates`: sequencer-uptime + staleness + positivity, and
  a ratio-tolerance check that also gives on-chain slippage protection under
  market rates). Contract-only, no circuit/verifier change. **Removes the trusted
  price.** Inert while swaps are off; still requires the H1 accounting fix before
  swaps re-enable.
- **L-1** (`c45c2c7`): `PaymentMemo` no longer emits the sender (`poster`). Live
  on the Tempo memo board; the Robinhood Chain board has not been redeployed.

## Still open: mainnet gate (honestly disclosed, not demo blockers)

- **H1 proper fix**: make swap amounts public + update `deposited[]` with a
  solvency check (reveals size, trades away privacy), OR back swaps with an
  owner-funded `assetOut` reserve. A protocol design decision, left for the owner.
  `secret != 0` is now in `sealedSwap.circom` source; it needs a recompile and
  ceremony before re-enabling.
- **M-2**: multi-party trusted-setup ceremony; repin production hashes.
- **M-4 residual**: single-wallet owner. The timelock is live; moving the owner
  to a multisig is a mainnet ops decision.
- **M-3 residual**: a user-facing slippage-tolerance control wiring `minOut`
  through `SealedTradePanel`, landed with the oracle-swap re-enablement.
- **L-1 on Robinhood Chain**: redeploy the memo board from the fixed source, or
  keep relaying memos there.

---

## Second pass: Kensho multi-fleet audit (2026-09-10, RH 46630 + Tempo 42431)

Internal. Seven parallel finder agents (ZK public-input alignment, Merkle tree,
nullifier / double-spend / cross-chain replay, reentrancy / ERC-20 / accounting,
Tempo + cross-chain, access-control / swap-oracle / memo, circom soundness), each
handed the prior dupe digest, then owner-verified against the code, the compiled
circuit, and live on-chain reads.

**On-chain confirmed (both pools at the time, both since superseded):** real
Groth16 stack wired, bound-shield enforced, swaps disabled.
- RH `0xaEbB…1834` (superseded): verifier `0xB077…7EF`, shieldVerifier `0x28E6…2847`, sealedSwapVerifier `0x0`.
- Tempo `0x3eee…d30b` (superseded): verifier `0x82F4…03A2`, shieldVerifier `0x7836…6Eb3`, sealedSwapVerifier `0x0`.

The current pools reuse the same verifiers; see "Current pools" above.

**Swept clean (re-verified, no new finding):** circuit↔contract public-input
order/count/encoding (3/4/5/9 exact); all four Groth16 verifiers field-range-check
every public input; Merkle zeros + EMPTY_ROOT re-derived from circomlibjs (20/20 match);
root history is permanent (no eviction); nullifier binding + shared-`spent` cross-path +
CEI ordering; cross-chain replay bound by per-chain roots + per-chain `deposited[]`;
6-dec PathUSD accounted correctly (contract is decimals-agnostic on the live paths);
Tempo native path inert/untrickable; `insert` is constant-gas (no 30M brick).

**New findings + fixes (this pass):**

| ID | Severity | Status |
|----|----------|--------|
| F-1 | High (latent, live only if oracle-swaps re-enabled) | **FIXED in code + tested**, on-chain since 2026-09-16 |
| F-2 | Medium (issuer-triggered, unrecoverable) | **DOCUMENTED + mitigations specified** |
| INFO-1/2/3 | Hardening | **FIXED in code + tested**, on-chain since 2026-09-16 |
| SS-circom | Low (latent) | **FIXED in circuit source** (needs recompile+ceremony+redeploy). *Superseded 2026-10-11 for the product wrap: see ZK-1* |

- **F-1: `OracleRates.requireRatio` dropped decimal normalization.** With an oracle-
  bound swap across mismatched-decimal assets (exactly the Tempo 6-dec ↔ RH 18-dec
  case), the enforced `amountOut` was off by `10^|decIn-decOut|`, a permissionless
  over-mint + drain once enabled. **Fix:** `requireRatio` now normalizes by asset
  decimals and requires equal feed decimals, re-checked at call time (immune to
  `setPriceFeed` reordering). Wired via `_assetDecimals()` in `sealedSwap`. Proof:
  `OracleRates.t.sol`: `test_naive_rate_rejected_for_mixed_decimals` (the old bug
  rate now reverts), `test_mixed_decimals_fair_rate_ok`,
  `test_reverts_on_feed_decimals_mismatch`.
- **F-2: issuer freeze of the pool's own token balance** permanently freezes every
  note of that asset. At the time `emergencyWithdraw` (same `token.transfer`)
  could not rescue it either; it has since been removed. Issuer-triggered, so not
  a permissionless crit, but real and unrecoverable. Can't be code-fixed
  (trusted-party action); documented with required mitigations in
  `TEMPO-COMPLIANCE-DESIGN.md` (per-asset pause, no single-freezable-account
  concentration, non-freezing first asset for mainnet).
- **INFO-1/2/3 (defense-in-depth), all fixed + tested** (`GloamHardeningFixes.t.sol`):
  a `nonReentrant` latch on every value-moving external fn (removes reliance on CEI +
  STATICCALL holding under future edits); an explicit `NotAContract` check on a codeless
  `asset` in shield (no phantom `deposited` credit); and `sweepStrayNative()` to recover
  ETH sent via `receive()` above `deposited[address(0)]` (otherwise stuck).
- **sealedSwap.circom** (not deployed; `sealedSwapVerifier==0`): added `secret != 0` on
  all three notes (closes the known L1) and 128-bit range checks on `rateIn/rateOut/
  amountOutMin` (~~product-wrap +~~ `amountOutMin ≥ 2^252` slippage-floor bypass). Compiles
  clean; **inert until the H1 re-enable recompiles + reruns the ceremony + redeploys.**
  **Superseded 2026-10-11: the 128-bit rate checks do NOT close the product wrap.**
  Two 128-bit numbers multiply past the ~2^254 field, and on an oracle pair the
  caller picks the absolute rates. See ZK-1 below. The `amountOutMin` part still
  holds. The same wrong claim sits in the circuit comment (`sealedSwap.circom`
  step 3c); it gets corrected with the ZK-1 circuit change.

**Headline (2026-09-10):** no new permissionless critical/high on current code. The
disabled swap path neutralizes the highest-severity surface, and the shielded core
(ZK, Merkle, nullifier, accounting) is sound. F-1 (the one substantive latent High)
is fixed and tested; the Tempo issuer-freeze Medium is documented with mitigations;
hardening landed. All tests green at the time (66/66). These landed on-chain at the
2026-09-16 redeploy and carry into the current 2026-09-29 pools (93/93 tests after
the no-admin-withdraw change).

---

## 2026-10-11 audits (Kensho + ZK review)

Two internal passes, both on `origin/main` `0ec4026`, both read-only on chain
(`eth_call` and `eth_getLogs` only, no transactions, no keys):

- **Kensho** (`AUDITS/kensho-2026-10-11.md`): contracts, deploy scripts, the
  relay, payroll, the proof checkers and the memo board.
- **ZK review** (`gloam-audit-zk-report-2026-10-11.md`): circuits, verifying
  keys, public-input binding and the off-chain proof checkers.

Both live pools read back byte-identical to `src/ShieldPoolPoseidon.sol`,
solvent per asset, with `sealedSwapVerifier = 0` and nothing queued. No
permissionless way to steal, inflate, lock or double-spend pooled funds was
found on the live paths (shield, transfer, unshield). Verifying keys and input
order match the circuits on both chains.

| ID | Severity | Status |
|----|----------|--------|
| ZK-1 | High (latent), Critical on re-enable | **OPEN, sealed swap stays OFF**: scripts guarded, regression test added, circuits unchanged |
| N-1 | Medium | **FIXED in app (checker + wording)**; recipient binding needs a note-format change |
| ZK-2 | Medium | **FIXED in app**: gloamdisc1 never verifies; Exact balance rebuilt as gloambal1 |
| ZK-3 | Medium | **FIXED in app (checker + wording)**; payer can still prove the payee note (bearer notes) |
| R-1 | Low | **Contract part DEFERRED to next redeploy**; relay side mitigated in app |
| L-2 | Low | **FIXED on branch**: every script that deploys or wires a sealed swap verifier refuses without an explicit ack |
| L-3 | Low | **DOCUMENTED + monitored**; tree rollover before mainnet |
| ZK-4 | Low | **FIXED in app**: size, snark, label and fields first; no chain read for a failed proof |
| Kensho I-1, I-2 | Info | **DOCUMENTED** |
| Kensho I-3 | Info | **FIXED in app, relay and SDK**: cash out to the vault or memo board refused |
| ZK I-1 | Info | **DOCUMENTED** |
| ZK I-3, I-6 | Info | **FIXED in app**: labels stripped of hidden characters; gloamdisc1 key hash-pinned |
| ZK I-2, I-4, I-5 | Info | **OPEN, tracked** (note-format change and fee design before the production ceremony) |

Contract tests: 97/97 green (`forge test`, 2026-10-11), including
`KenshoOct11.t.sol` and the ZK-1 regression.

### Contracts and scripts

- **ZK-1 (High, latent; Critical on re-enable): the sealed swap rate product
  wraps the field.** `sealedSwap.circom` checks
  `amountOut * rateOut === amountSwap * rateIn`. Amounts and rates are each
  capped at 128 bits, so the product can reach 2^256 while the field is about
  2^254, and the equality can hold mod p while the real integers differ by p.
  On an oracle-bound pair the contract only checks the ratio `rateIn/rateOut`
  against the feeds (`OracleRates.requireRatio`), so the caller picks the
  magnitude. With `rateOut` near 2^126.3 and `rateIn = 2*rateOut - (p mod rateOut)`,
  1 wei of assetIn proves into about 2.57e38 units of assetOut, at a ratio
  inside a 1% band. That note then drains real assetOut deposits through a
  normal transfer and unshield. Owner-pinned rates only bite above about
  2^125.7, which no sane price scale reaches; oracle pairs are the real path.
  The old and the current circuit are both affected.
  - Proof: `test/auditzk/SealedSwapRateWrap.t.sol` runs it end to end on a real
    `ShieldPoolPoseidon` with the repo's real unshield and transfer verifiers and
    a dev verifier for the current circuit (`test/auditzk/SealedSwapVerifierCurrent.sol`,
    test only). The attacker shields 1 wei of A, swaps, and unshields the
    victim's 1000 B; `deposited[B]` ends at 0. The test passes today on purpose.
    Flip it to expect a revert before anything re-enables swaps.
  - Live impact: none. `sealedSwapVerifier` is `0x0` on both pools.
  - Unwired verifier: the dev-key pair on Robinhood Chain testnet,
    `SealedSwapIVerifier` `0x9D866ca3b981585D5E6B138E4411C804c4d6C198`
    (Groth16 `0xa06461Ec…2B89`), returns `true` for the ZK-1 proof on `eth_call`.
    It is not wired to any pool and must never be.
  - Required fix, both parts, before any re-enable:
    1. amount bits + rate bits <= 252, for example `Num2Bits(96)` on
       `rateIn`/`rateOut` in the circuit and `rateIn, rateOut <= type(uint96).max`
       in `sealedSwap`;
    2. take the magnitude away from the caller on oracle pairs: fix one side to
       a constant scale (for example `rateOut == 1e18`), or reduce by gcd and cap.

    Then a new circuit build, a new ceremony and a regenerated verifier.
  - Status: **open, sealed swap stays off.** Deploy scripts guarded (L-2).
    Circuits and `src/ShieldPoolPoseidon.sol` are unchanged on purpose: the live
    pools are verified byte-identical to this source, and the fix lands with the
    H1 redesign as one circuit change, one ceremony and one redeploy.

- **R-1 (Low, contract part): a losing duplicate spend pays for full proof
  verification.** `transfer`, `unshield` and `sealedSwap` verify the Groth16
  proof before they read `spent[nullifier]` (`src/ShieldPoolPoseidon.sol:472-473`,
  `:579-580`, `:534-546`). When two copies of the same relayed spend race, the
  losing copy burns about 296k gas on the pairing check before it reverts
  `AlreadySpent`. Measured in
  `test/KenshoOct11.t.sol::test_R2_duplicate_spend_pays_full_verification_before_AlreadySpent`:
  first copy 333,996 gas, duplicate 296,543 gas, a spent-first read 3,051 gas.
  No funds at risk; the cost lands on whoever submits, which is the relay.
  - Fix at the next redeploy: check `spent[nullifier]` before verifying, and
    keep the `spent[nullifier] = true` write after the proof passes. Safe: the
    proof check is a view call inside `nonReentrant`, so nothing changes between
    the read and the write.
  - Not applied now: the live pools are byte-identical to the current source,
    and the reorder only ships with a new pool.
  - App side (branch `proofix`, `app/src/lib/relay/server.ts`, `inflight.ts`):
    every relayed send and cash out takes a lock on `chainId + nullifier`
    (Upstash `SET NX EX 180`, process memory when Redis is not set or does not
    answer) before anything is read from the chain, so a second copy of the same
    proof gets 409 `in_flight` instead of a dry run and a losing send. The lock
    is dropped when nothing went out and kept until it expires once a
    transaction may have. The relay reads `spent` and `isKnownRoot` before the
    gas estimate on both paths, so a spent nullifier never reaches the
    simulation. Relayed memos are capped at 2048 bytes (the largest real sealed
    ticket is 1714; the board itself still takes 8192), on top of the existing
    per-sender, per-payment, per-IP and per-network caps. Covered by
    `app/scripts/selftest-relay.mts`.
  - Still open: dust self-sends cost the relay about 1.8M gas each and look
    like real use. The real fix is the in-circuit relay fee before mainnet
    (see ZK I-5).
  - Status: **contract part deferred to the next redeploy (documented); relay
    side mitigated in app.**

- **L-2 (Low): deploy scripts could turn sealed swap back on with no guard.**
  `DeployPoseidonPoolSealed.s.sol` wired an old sealed swap adapter, the
  superseded `DualProofVerifier 0x4B0D…949C` and Poseidon2 `0xcc2d…0947`, then
  ended setup. `DeploySealedSwapStack.s.sol` set or queued
  `setSealedSwapVerifier` on any `POOL`. `circuits/scripts/deploy-phase2.mjs`
  wired one on every run.
  - Fix: new `script/SealedSwapGuard.sol`. Every Solidity script that deploys,
    sets, queues or wires a sealed swap verifier calls `_requireSealedSwapAck()`
    first, which reverts unless `GLOAM_ACK_SEALED_SWAP_H1_ZK1=1`. The revert says
    sealed swap must stay off until H1 and ZK-1 are fixed and a new circuit and
    ceremony are done. Guarded: `DeployPoseidonPoolSealed`,
    `DeploySealedSwapStack` (deploy-only and set/queue paths) and
    `DeploySealedSwapVerifier`. `deploy-phase2.mjs` now skips the sealed swap
    verifier entirely (no deploy, no wiring, `sealedSwapVerifier` stays 0)
    unless the same flag is `1`.
  - `DeployPoseidonPoolSealed` no longer hardcodes any address. `POSEIDON2`,
    `DUAL_VERIFIER`, `SEALED_SWAP_IVERIFIER` and `SHIELD_IVERIFIER` come from env,
    so it cannot silently wire stale contracts. For a pool with sealed swap off,
    use `DeployTempoPool.s.sol` (it works on any chain).
  - Checked: each guarded script reverts with that message when run without the
    flag (local simulation, no broadcast). Same idea as the `shieldVerifier`
    check in `SeedVaultInventory.s.sol`: refuse by default.
  - Status: **fixed on branch.**

- **L-3 (Low): the depth-20 tree can be filled.**
  `IncrementalMerkleTreePoseidon` has `DEPTH = 20` (1,048,576 leaves) and
  reverts `TreeFull` after that. Measured: one leaf insert about 874k gas
  (`test_info_tree_insert_cost`), one private send about 1.8M gas for two leaves
  (`test_info_relayed_transfer_cost`). Filling the rest with self-sends is about
  524k sends, roughly 9.4e11 gas, all paid by the attacker, for no gain. Live at
  audit time: Robinhood Chain `nextIndex` 63, Tempo 18.
  - If filled: no new deposits, sends or swaps. Exits still work: `unshield`
    does not insert, so every existing note can still cash out. Recovery is a
    new pool and a migration.
  - Plan: monitor `nextIndex` on both pools. `GET /api/v1/vaults` now returns
    `chain.leafCount`, `chain.leafCapacity` (1,048,576) and `chain.leavesLeft`
    for each network. The transparency page does not show it yet (it never
    reads `nextIndex`; adding it is a new read and a new UI row). Before mainnet,
    add a tree rollover (a new tree epoch, with old roots still accepted for
    spends).
  - Status: **documented + monitored.**

### Info

- **Kensho I-1: Tempo native balance is a placeholder.** `eth_getBalance`
  returns the same `4242…42` value for every address and Tempo rejects value
  transfers, so the pool's native path and `sweepStrayNative` are inert there.
  Code must never trust `address(this).balance` on Tempo. Status: **documented.**
- **Kensho I-2: no event for the initial verifier.** The constructor sets
  `verifier` without emitting `VerifierSet`, so an event-only watcher never sees
  it. Watchers read `verifier()` at `SetupEnded`. Status: **documented.**
- **ZK I-1: stale sealed swap artifacts.** `app/public/circuits/sealed_swap_final.zkey`,
  `src/verifiers/SealedSwapVerifier.sol` and the unwired RH verifier above match
  the old circuit build (6,649 constraints), not the current source (7,036).
  `snarkjs zkey verify` fails against the current circuit. Wiring them would
  ship none of the source hardening, and ZK-1 hits both builds. Status:
  **documented** (`SEALED_TRADE.md`); replaced by the ZK-1 circuit change.

### App side

All on branch `proofix`. Regressions: `app/src/lib/proofs/verify.selftest.mjs`
(64 assertions, real Groth16 proofs, in-memory chain),
`payrollCheck.selftest.mjs` (50), `app/scripts/selftest-partners.mts` (server
path) and the Kensho PoC `kensho-oct11.poc.mjs`, which now asserts the bad
cases fail.

- **N-1 (Medium): proof of payment and payroll total do not bind the
  recipient.** Fixed in the checker, worded honestly for the rest:
  - A receipt note counts only when it is output 0 of a private send
    (`newCommitments[0]`), the way the app, the SDK and the payroll runner all
    build a send (`buildTransferWitness`). Change (output 1), deposits and trade
    outputs fail (`app/src/lib/proofs/chain.ts` `noteOriginIn`, `findNoteTx`).
  - Fail closed: a named transaction that is not on the chain fails; a
    payment with no tx hash that is older than the bounded scan, or a network
    that does not answer, is "can't confirm", and no check may stay unknown in
    a verified result (`verify.ts` `allPassed`, `paidCheck`). The server and the
    hosted MCP use the same checks (`lib/proofsServer.ts`); the old exception
    that let "when the payment landed" stay unknown is gone everywhere.
  - Payroll: change was already rejected; a named transaction missing from
    the chain now fails too.
  - The prover refuses to make a proof of payment for its own change, a
    deposit or a trade output (`prove.ts` `provePayment`).
  - Wording: a proof of payment reads "a private payment of at least X",
    made into a note whose key the prover holds, which the payer also knows;
    the payroll total reads "N payments adding up to X", funded by the prover.
    Both list what they do not prove on `/verify`.
  - Still true, documented: a send to yourself still produces a valid
    receipt, and a payroll payment back to the employer still counts as a
    payment. Nothing on chain tells them apart without a payee key in the note.
  - Status: **fixed in app**. Binding the recipient needs a note-format and
    circuit change (a payee public key in the commitment, a nullifier from the
    payee's private key) plus a new ceremony.
- **ZK-2 (Medium): "Exact balance" (`gloamdisc1`) can be forged from public
  `shieldBound` calldata.** `gloamdisc1` is never verified any more: the page,
  `POST /api/v1/proofs/verify` and the hosted MCP tool answer "can't confirm
  who holds this" whatever its math (`lib/disclosure.ts` `LEGACY_DISCLOSURE`,
  `lib/proofsServer.ts` `verifyDisclosureServer`), with no chain lookup. Exact
  balance in the app is rebuilt as `gloambal1`: the receipt circuit with the
  amount shown, sealed for the `balance` kind, a label and an expiry, made on
  the device and never published (`prove.ts` `proveBalance`). The kind in the
  context keeps a balance proof and a payment proof from passing as each
  other. It does not show the note is still unspent; the page says so. Status:
  **fixed in app.**
- **ZK-3 (Medium): proof of payment does not prove a payment was received.**
  Change and own deposits now fail, and a made-up tx hash fails instead of
  reading as unknown (see N-1). The payer chooses the payee note's key, so the
  payer can still make the payee's receipt: the claim now reads "a private
  payment was made", never "you received". Status: **fixed in app (checker
  and wording)**; true receiver binding is the same owner-key change as N-1.
- **ZK-4 (Low): the checkers do chain work before the proof is known to be
  valid.** Size and format checks, the snark, the label and the fields all
  run first, and nothing is read from the chain for a proof that already
  failed (`verify.ts`, `payrollCheck.ts`). Payroll proofs are capped at 8
  parts and 256 payments in `decodeProof` and in the checker; proof text at
  160,000 characters (the largest real one is about 95 KB); the API body is
  capped before it is parsed (`jsonBody(req, maxBytes)`). Route rate limits are
  unchanged. Status: **fixed in app.**
- **Kensho I-3 (Info): cash-out to the pool itself.** Refused in the app
  before proving (`MoveView`, `VaultTradePanel`), in the relay before any lock
  or chain call (400 `vault_recipient`), and in the SDK's `buildUnshieldIntent`.
  The memo board address is refused too (`app/src/lib/cashOutTarget.ts`).
  Status: **fixed** (app, relay, SDK). The contract still accepts it; a
  contract-side `to != address(this)` check can ship with the next redeploy.
- **ZK I-3 (Info): verifier labels are not normalized for Unicode.** Format
  and control characters (zero width, bidi marks and overrides, BOM) are
  stripped when a label is sealed (`cleanVerifierLabel`) and when one is shown
  (`app/src/lib/proofs/label.ts`); labels over 80 characters are cut on the
  page, and the check notes when hidden characters were removed. Status:
  **fixed in app.**
- **ZK I-6 (Info): the client-side `gloamdisc1` check fetches
  `shield_vkey.json` without the sha256 pin.** Pinned in
  `circuitArtifacts.ts` and checked before use. Status: **fixed in app.**

Open and tracked: ZK I-2 (payroll edge case: Alice can count Bob's payment
back to her if Bob paid from the note she sent him; same owner-key note fix as
N-1 and ZK-3, or auto-sweep on receive), ZK I-4 (a funds proof's root shows the
tree size and the page shows how many notes back it; accepted for testnet),
ZK I-5 (a mainnet relay fee and the pitch's in/out fee need a new public output
in the circuits; design it before the production ceremony so there is one
ceremony, not two). Status: **open.**
