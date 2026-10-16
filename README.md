<div align="center">

# Gloam

### Private money on public chains. Private stablecoin payments for people, teams and AI agents: private by default, provable on demand.

[gloam.trade](https://gloam.trade) · [Testnet app](https://gloam.trade/app) · [Verify a proof](https://gloam.trade/verify) · [Research report and deck](https://gloam.trade/pitch) · [How Gloam compares](https://gloam.trade/docs/compare) · [Docs](https://gloam.trade/docs) · [Whitepaper](https://gloam.trade/whitepaper) · [@gloamtrade](https://x.com/gloamtrade)

**Robinhood Chain** `46630` · **Tempo** `42431` · testnet only, real ZK proofs, no mock fills

</div>

![Gloam: private money on public chains](https://raw.githubusercontent.com/cryptoduke01/gloam/main/app/public/media/readme-home.jpg)

---

Stablecoins are becoming how businesses and AI agents pay each other, and every one of those payments is public. Gloam makes them private, and lets the payer prove exactly what someone needs to see: a balance above a figure, that a payment was made, or a payroll total, to one named reader, with an expiry. It runs on Tempo and Robinhood Chain testnets today. Robinhood Chain stock tokens can be held and sent privately too, and private trading is underway with a new engine.

**Why one owner matters.** Privacy splits into two jobs. Shared secrets (sealed auctions, order books, lending pools) need someone to compute on many people's hidden data, so FHE and MPC networks such as Zama and Arcium use a committee that holds keys. A payment has one owner, so the owner proves it on their own device with zero-knowledge proofs, and nobody else ever holds a key. If a committee or operator is breached, everyone can be exposed, past payments included. If one owner's device is breached, one person is. Gloam does not invent new cryptography: it uses the proven ZK maths of the Zcash lineage and builds the payments product on top. Full comparison with Zama, Arcium, Tempo Zones, Helius Privacy and Railgun: [gloam.trade/docs/compare](https://gloam.trade/docs/compare).

## What is new

Gloam is not new cryptography. It is a new building block for finance: private payments you can prove. As far as our research found, three parts are new:

1. **Payroll total proof.** `payroll_total` proves a run of up to 32 payments adds up to exactly a total, all funded by the prover, without showing who got what. We found nothing like it.
2. **Proofs scoped to one reader.** The label (who the proof is for), expiry, chain and pool are hashed into a public `context` input bound into the `solvency`, `receipt` and `payroll_total` proofs. Change the label and the proof fails. Anyone can check one in a browser, with no wallet, at [`/verify`](https://gloam.trade/verify). Viewing keys, the usual alternative, show a whole history and cannot be taken back.
3. **Private payments for AI agents.** A private payment method proposed for the Machine Payments Protocol from Tempo and Stripe ([tempoxyz/mpp-specs#376](https://github.com/tempoxyz/mpp-specs/pull/376); MPP had no private method), private x402 payments, and an MCP server that gives agents handles instead of secrets, with spending limits.

Not new: the private pool design (Zcash lineage from 2016, Tornado, Railgun, Cloak) and selective disclosure as an idea (Zcash and Railgun viewing keys, Privacy Pools, Zama decryption rights). One honest limit: a reader can still forward a proof. It says who it was for and when it expires, and a designated-verifier mode is next.

## Three surfaces, one private core

The vault app is the reference implementation, not the whole product.

| Surface | What it is | Package |
| --- | --- | --- |
| **SDK** | Drop shielded balances, private sends, and selective disclosure into any onchain app or agent, on Robinhood Chain or Tempo. Unsigned intents + client proving. | [`@gloamtrade/sdk`](./packages/sdk) |
| **Agents** | An MCP server + a reference wrapper so an AI agent can shield, move value, and pay for tools privately over x402 or MPP, under policy. | [`@gloamtrade/mcp`](./mcp) · [`@gloamtrade/mppx-gloam`](./packages/mppx-gloam) · [`examples/`](./examples) |
| **Vault** | The live testnet app that proves the whole path works. | [`app/`](./app) |
| **Partner API** | Apps add private payments with an API key, set their own fee (flat per private payment, a share of cash outs and deposits), and see attributed volume and would-be fees live in the partner portal. Testnet: nothing is charged; real fees need a fee output in the circuits, part of the mainnet ceremony. | [`/partners`](https://gloam.trade/partners) · [`/docs/partners`](https://gloam.trade/docs/partners) · `GloamApiClient` |

![The Gloam app: a private balance only you can see](https://raw.githubusercontent.com/cryptoduke01/gloam/main/app/public/media/readme-app.jpg)

All three share one core: a Poseidon note scheme, a depth-20 incremental Merkle tree, circom witness builders, real Groth16 verification, and one canonical intent shape.

## What works today (testnet, real ZK proofs)

| Path | Status | What you can do |
| --- | --- | --- |
| **Shield** | Live, proof-gated | Deposit ETH, USDG (Paxos Global Dollar) + faucet stock tokens on Robinhood Chain, PathUSD and other stablecoins on Tempo; the hardened pool enforces `shieldBound()` so a deposit proves `commitment == Poseidon(secret, amount, asset)` (audit C1) |
| **Private send** | Live | Send inside the vault to a receive tag; an on-chain encrypted memo inbox (`GloamPayMemo`) lets the recipient find it. Tempo's memo board does not record who posted. The Robinhood Chain board still indexes the poster, so there the sender stays off the memo record only when the Gloam relay posts it. Without the relay, your wallet is the visible submitter on either chain |
| **Private payroll** | Live | Upload a CSV and pay a whole team at once in USDG (Robinhood Chain) or PathUSD (Tempo). Gloam-address payees are paid directly and notified on-chain; everyone else gets a claim link. Crash-safe resume, results export. [Docs](https://gloam.trade/docs/payroll) |
| **Scheduled payroll** | Live | Save a pay list as a schedule (monthly, every two weeks, weekly or one time) with a cap per run and an end date. A "Payroll due" reminder runs it in one click. Runs happen in your browser because only you hold the keys; schedules are encrypted at rest |
| **Payment requests** | Live | Share a link or QR that opens Pay with your Gloam address, amount, asset and reference filled in. The details sit after the `#`, so they never reach a server and nothing about the request goes on-chain |
| **Gloam relay** | Live | Submits proven sends, cash outs and payment memos from a Gloam account so the user's wallet never appears. One request per spend at a time, small memos only, and no cash out to the vault itself. Dry-runs every payment against the pool first; cash-out recipients are bound in the proof, so the relay can only submit or refuse. SDK `relayIntent`, MCP `GLOAM_USE_RELAY=1` |
| **Passkey lock** | Live, optional | Protect the private balance on a browser with a passkey (Face ID, Touch ID, security key). The WebAuthn PRF output wraps the key that encrypts notes at rest, so the app unlocks only with the passkey. Backups stay restorable without it. Browsers without PRF keep the device key. [Docs](https://gloam.trade/docs/privacy-model#security) |
| **Sanctions screening** | Live | Checked against a vendored snapshot of the OFAC sanctioned-address list (EVM): the depositing wallet in the app before signing and at `/api/screen`, and every cash-out address inside the relay before it submits. Public addresses only; a blocked wallet sees one neutral message. Refresh with `node app/scripts/refresh-ofac-list.mjs`; optional Chainalysis check via `CHAINALYSIS_API_KEY` |
| **Issuer policies (Tempo)** | Live | Deposits and cash outs on Tempo also respect the stablecoin's TIP-403 transfer policy: the wallet must be allowed to send and the vault to receive on deposit, the vault to send and the recipient to receive on cash out. Read-only checks in the app, at `/api/screen` and in the relay, next to sanctions screening, with a warning when an issuer policy or pause would block the vault itself. Compliant privacy with no operator |
| **Cash out** | Live, proof-gated | Unshield to a public balance with a real browser-generated Groth16 proof |
| **Exact balance** | Live, new format | Prove one private balance exactly, revealing nothing else. A `gloambal1` proof is made on the device from the receipt circuit with the amount shown, carries a label and an expiry, and never goes on chain. The older `gloamdisc1` disclosure is retired: anyone could copy one from a public deposit, so `/verify` no longer accepts it |
| **Proof of funds** | Live, new circuit | Prove you hold *at least* an amount across up to four private balances, without showing the balance. A `gloamfunds1` proof carries a label (who it is for) and an expiry, both bound into the proof; it is verified off-chain at [`/verify`](https://gloam.trade/verify), in the browser against the live vault, including that the backing balances are still unspent. [Docs](https://gloam.trade/docs/proofs) |
| **Proof of payment** | Live, new circuit | A `gloampay1` receipt showing a private payment was made (either side of the payment can make one; it does not yet show who paid or who received): show the amount, or only that it was at least some amount, anchored to the real payment in the vault. Same label and expiry, verified off-chain at `/verify`. The checker fails closed: a payment it cannot confirm on chain, a change output or a deposit never passes |
| **Payroll total proof** | Live, new circuit | A `gloamroll1` proof that a payroll run paid exactly a total in a given number of private payments, without showing any single amount. Same label and expiry, verified off-chain at `/verify` |
| **Private agent payments (x402)** | SDK + MCP live | Agents pay for tools over HTTP 402 with a private send. The payment note is sealed to the payee's receive tag, and the payee sweeps it into a fresh note before serving, so the payer cannot spend it back. `settleGloamPayment` in the SDK, `gloam_fetch_paid` / `gloam_verify_payment` in the MCP server |
| **Agent spending limits** | Live (MCP) | The owner sets each agent's assets, per-payment and per-day caps, allowed recipients, tools and expiry. Every spend is checked and logged before it is proved or signed; no limits means no spending. Note secrets stay in an encrypted store inside the server and the agent only sees handles. Enforced by the MCP server, off-chain. `gloam_get_limits`, `gloam_get_spending_report`. [Config](./mcp/README.md#spending-limits) |
| **Hosted MCP server** | Live | Paste `https://www.gloam.trade/mcp` into Claude (Settings, Connectors, Add custom connector), ChatGPT, Cursor or any MCP client; nothing to install. Read and plan only: networks and assets, vault stats, payment request links, proof checks, deposit plans and MPP how-to. It never signs and refuses anything that looks like a key or note secret; for signing, the local server (`npx -y @gloamtrade/mcp`). [Docs](https://gloam.trade/docs/agents#connect-by-url) |
| **Transparency page** | Live | [`/transparency`](https://gloam.trade/transparency) shows what anyone can see about the vault on each network: what it holds, counts of deposits, private transfers, cash-outs and payment messages, and recent public activity, read straight from public nodes |
| **Stock tokens** | Live (Robinhood Chain) | Shield testnet stock tokens (TSLA, AMZN, PLTR, NFLX, AMD), hold them privately and send them privately, like any other asset in the vault |
| **Private trade** | Built, switched off | `sealedSwap` is built and tested but off on both chains (`sealedSwapVerifier` is `0x0`) while we build a new engine for private trading. Trading mixes many people's orders, so it needs its own design (the first version hit audit H1, solvency, and the 2026-10-11 review found a rate overflow, ZK-1; deploy scripts now refuse to wire it back on without an explicit acknowledgement). Oracle-bound rates are built and tested too; see below |

Every private action is proof-gated on-chain. No mock fills, no theatrical privacy. If a path cannot be both private and solvent yet, it waits. See [`contracts/audit/H1-SWAP-SOLVENCY.md`](./contracts/audit/H1-SWAP-SOLVENCY.md).

## Selective disclosure: private by default, proven by choice

The answer to the "dark pool" objection. A holder proves one fact about their money to one reader, and nothing else. Four proofs: `gloambal1` (exact balance), `gloamfunds1` (at least an amount), `gloampay1` (a payment was made) and `gloamroll1` (payroll total). Each carries a label naming who it is for and an expiry, both bound into the proof, and each is checked off-chain at [`/verify`](https://gloam.trade/verify) against the live vault, with no wallet. Make them at `/app/disclose`.

What they do not prove is said plainly on the verify page: a proof of payment shows a payment was made, not which side of it the holder was on, because notes do not yet bind a recipient key. The original `gloamdisc1` format reused the deposit statement, so anyone could copy one from public deposit data; it is retired and never verifies.

## Robinhood Chain native

Robinhood Chain is an **Arbitrum Orbit L2** (Nitro, mainnet live since July 2026), ETH gas, Ethereum blob DA. Gloam targets what the chain actually ships:

- **Chainlink oracles from block zero.** RH Chain prices tokenized equities on-chain via standard `AggregatorV3` feeds. Gloam's `OracleRates` module binds sealed-trade rates to the live feed with L2 sequencer-uptime, staleness, and positivity guards, and a ratio-tolerance check that is also on-chain slippage protection. Built and tested (`contracts/src/lib/OracleRates.sol`); it activates when private trade re-enables.
- **Tokenized stocks are ERC-20s** (18 decimals, ERC-8056 Total-Return value). Gloam shields the canonical set (TSLA, NVDA, AMZN, and more).
- **Groth16 runs native.** bn254 pairing precompiles are present and the 96 KB code-size cap fits large verifier contracts, so shield / unshield / transfer proofs verify with no special infra.
- **First-class ERC-4337** opens the door to gasless private transactions.

## Live on Tempo testnet

The same private core now runs on [Tempo](https://tempo.xyz) testnet, the payments-first stablecoin L1, as private stablecoin payments for people and agents. Tempo ships its own operator-run privacy (Zones); Gloam is the self-custodial, permissionless complement, with selective disclosure a user can hand an issuer or auditor. The pool and verifiers are deployed on Tempo Moderato (`42431`), and the app's runtime network toggle switches the whole product between chains: shield PathUSD, send, and cash out, proof-gated end to end. Because Tempo blocks native `msg.value` and pays gas in stablecoins, Gloam shields ERC-20 stablecoins there instead of a native asset. Design and constraints: [`TEMPO_EXPANSION.md`](./TEMPO_EXPANSION.md).

## Trust, verified

Privacy earns the mainnet gate only when it is auditable and correct.

- **Reviewed again on 2026-10-11.** A Kensho audit of the contracts and an independent review of the circuits found no way to steal, inflate, double-spend or redirect pool funds, and confirmed both live pools match this repo byte for byte and are fully solvent. They did find the proof checker overclaiming (fixed: it fails closed and counts only real payments), a copyable legacy disclosure (retired), relay gas waste (fixed) and a latent overflow in the switched-off swap circuit (blocked until the new engine). Every finding and its status is in [`contracts/audit/REMEDIATION.md`](./contracts/audit/REMEDIATION.md).
- **Self-audited, then re-verified.** A Kensho pass found a critical funded drain, two highs, and a set of mediums in the sealed pool and client. Every critical and high is fixed or, for H1, switched off, and **verified on-chain and in code** (internal re-audit): the drainable pool drained and de-published, value-binding enforced at deposit (C1), the swap path disabled (H1), the re-open path closed (one-way verifier + two-step ownership). Audits so far are internal; an external audit is part of the mainnet gate. Full status: [`contracts/audit/REMEDIATION.md`](./contracts/audit/REMEDIATION.md).
- **No admin withdraw, timelocked rule changes.** Redeployed 2026-09-29 on both networks without an admin withdraw: there is no function the team can call to take pooled funds, and notes leave only through an unshield proof. The owner wallet can still swap verifiers or change rates and oracles, but setup has ended, so every such change must be queued on-chain and waits a public 3-day delay before it can run (`endSetup()`, `queueChange`, 97/97 tests). Verify `setupMode() == false` on the pools listed below.
- **Selective disclosure, not a mixer.** Prove balance or a payment to a counterparty or auditor without revealing everything. The right posture for a regulated-sponsor chain.
- **Fast vault sync, same privacy.** The app loads the vault's public leaf list (every commitment, in order) from `/api/vault-leaves` in one request instead of walking the chain, rebuilds the Merkle tree in the browser, and uses it only if the root matches the pool's on-chain root; otherwise it reads the chain itself. The request names only the network and is the same for everyone, so the server never learns which notes are yours.
- **Honest gates.** The trusted setup is a single-contributor dev ceremony and mainnet needs a multi-party one. Note secrets and the receive key are encrypted at rest (AES-GCM under a non-extractable device key, or wrapped by a passkey PRF), audit M-1. A payment someone sends you is moved into a fresh note only you know as you claim it, so the sender cannot spend it back. These are disclosed, not hidden. Mainnet `4663` is blocked in-product.

## Using the SDK

Deposit privately into the hardened pool in a few lines. The SDK mints the note and generates the shield proof; you sign the resolved call.

```ts
import { buildShieldBoundIntent, artifactProver } from "@gloamtrade/sdk";
import { parseEther } from "viem";

const intent = await buildShieldBoundIntent({
  amountWei: parseEther("0.001"),
  prover: artifactProver({ wasm: "shield.wasm", zkey: "shield_final.zkey" }),
});

// intent.exec is the resolved shieldBound(asset, amount, commitment, proof) call.
// Persist intent.note.secret to spend the balance later.
await wallet.writeContract({ ...intent.exec, abi: shieldPoolAbi });
```

Runnable examples are in [`examples/`](./examples): an agent that shields (`agent-shield`), a pay bot, private x402 and MPP payments, and a web shield. Start a new app with `npx create-gloam-app`.

## Architecture

```
gloam/
  packages/sdk/          @gloamtrade/sdk  the private path as a reusable package
  packages/mppx-gloam/   private payment method for the Machine Payments Protocol
  packages/create-gloam-app/  starter for a new app on the SDK
  mcp/                   @gloamtrade/mcp  agent server (plan + signed execution)
  examples/              agent-shield, pay-bot, pay-x402, mpp-gloam, web-shield
  app/                   Next.js reference app + docs → Vercel root: app
  contracts/             Foundry · ShieldPoolPoseidon vault, verifiers, circuits, audit
```

**Contracts: Robinhood Chain testnet `46630`**

| Role | Address |
| --- | --- |
| Sealed vault `ShieldPoolPoseidon` (no admin withdraw, 3-day timelock on rule changes) | [`0x7240…d740`](https://explorer.testnet.chain.robinhood.com/address/0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740) |
| Dual-proof verifier `DualProofVerifier` | [`0xB077…f7eF`](https://explorer.testnet.chain.robinhood.com/address/0xB077c620384813bB31Bb82Cd55b63608Ac20f7eF) |
| Pay memo `GloamPayMemo` (first deploy, indexes the poster) | [`0x689e…5DCE`](https://explorer.testnet.chain.robinhood.com/address/0x689ebd9d30E0235c73fd8f10236F850CDB3c5DCE) |

**Contracts: Tempo Moderato testnet `42431`**

| Role | Address |
| --- | --- |
| Sealed vault `ShieldPoolPoseidon` (no admin withdraw, 3-day timelock on rule changes) | [`0x841D…d5eb`](https://explore.testnet.tempo.xyz/address/0x841dc046ea3cc842ba3a855731472c6eb0f2d5eb) |
| Dual-proof verifier `DualProofVerifier` | [`0x82F4…03A2`](https://explore.testnet.tempo.xyz/address/0x82f4ece6533e48574914bedeb55a8242bc1a03a2) |
| Pay memo `GloamPayMemo` (no poster in the event) | [`0x3ca8…b4E3`](https://explore.testnet.tempo.xyz/address/0x3ca88712e9219b5ee4c82d31cafeab64c9e9b4e3) |

Earlier pools on both networks are superseded and listed in [`contracts/ARCHITECTURE.md`](./contracts/ARCHITECTURE.md); the pre-C1 RH pool `0x4F38…` is drained and retired, never use it. Circuits (Groth16 on BN254, Circom 2.1.6, Poseidon, depth-20 Merkle membership): `shield`, `transfer`, `unshield` and `sealedSwap` (disabled) for the pool, plus `solvency`, `receipt` and `payroll_total` for the off-chain proofs. Constraint counts and the dev-ceremony note are in [`contracts/circuits/README.md`](./contracts/circuits/README.md).

## Local

```bash
pnpm install
pnpm --filter @gloamtrade/sdk build        # build the SDK
cd contracts && forge test            # contracts (97 tests)
pnpm --filter @gloamtrade/sdk test         # SDK core self-tests
```

Run the reference app from `app/` (`next dev`), or open [gloam.trade/app](https://gloam.trade/app). The in-app network toggle switches between chains. Robinhood testnet ETH + stock tokens: [faucet.testnet.chain.robinhood.com](https://faucet.testnet.chain.robinhood.com/). Tempo test stablecoins (PathUSD and friends): the Tempo faucet (`tempo_fundAddress`).

## Guardrails

- Testnet only until a production ceremony + external audit. Mainnet `4663` blocked in-product.
- Real privacy only. Never fake or mock a private success.
- Selective disclosure over opacity. Verifiable, not just hidden.
- Brand: monochrome with a green tint (`#2e7d53` light, `#8fd3ad` dark), Aeonik, light and dark. Calm, spacious, plain-language.

---

No private keys in-repo. Deploy with `DEPLOYER_PK` env only. Circuit zkeys are dev-ceremony artifacts. See [`SECURITY.md`](./SECURITY.md).

Contact: [hello@gloam.trade](mailto:hello@gloam.trade) · [@gloamtrade](https://x.com/gloamtrade) · Telegram [t.me/gloamhq](https://t.me/gloamhq). Found a security issue? See [`SECURITY.md`](./SECURITY.md#reporting-a-vulnerability).
