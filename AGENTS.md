# Gloam

**Thesis: Stablecoins are becoming how businesses and AI agents pay each other, and every one of those payments is public. Gloam makes them private, and lets the payer prove exactly what someone needs to see.**

Tagline: private by default, provable on demand. Hero line: private money on public chains.

- Lead with stablecoin payments, payroll and agent payments, on Tempo and Robinhood Chain mainnets (beta, real money). The testnets are the free practice network with test funds.
- Why the tech fits: a payment has one owner, so the owner proves it on their own device with zero-knowledge proofs and nobody else holds a key. Committee systems (Zama FHE, Arcium MPC) and operator systems (Tempo Zones) suit shared secrets, not single-owner payments.
- Not new cryptography: the Zcash-lineage pool. New, as far as our research found: the payroll total proof, proofs scoped to one reader with an expiry (`context` input), and private payments for agents (MPP method proposal, x402, MCP with spending limits).
- Stock tokens: Robinhood Chain testnet only, held and sent privately there. Private trade is built and switched off on every network (the mainnet pool has no swap code) while we build a new engine for private trading. No dates.
- Never claim "first" or "only". Mainnet is live in beta: say it handles real money, has beta deposit limits, was reviewed internally (20 October 2026) and that an external audit is planned. Never say "audited". Never say private trading is live. $GLOAM: facts only (a mainnet pool asset on Robinhood Chain; half of Gloam's fees buy it back). Say "no admin withdraw, timelocked rule changes", not "no admin" or "trustless".
- Comparison and honest gaps: `/docs/compare`, `/docs/privacy-model`, `/docs/production`.

## Canonical

- Domain: `gloam.trade` (single host)
- Docs: `gloam.trade/docs`
- Whitepaper: `gloam.trade/whitepaper`
- Pitch deck: `gloam.trade/pitch` (source `app/public/pitch/index.html`; `pitch/gloam-deck.html` is a repo copy, keep them in sync)
- Product: `gloam.trade/app`, mainnet and the free practice testnet in one app, switched in-app (future testnet host: `testnet.gloam.trade`)
- X: `@gloamtrade`
- Vercel: one project, Root Directory = `app`
- Contracts: `contracts/` (Foundry). Mainnet: `ShieldPoolPayments` (payments only) on Robinhood Chain mainnet (`4663`) and Tempo mainnet (`4217`). Testnet: `ShieldPoolPoseidon` on Robinhood Chain testnet (`46630`) and Tempo Moderato testnet (`42431`)
- Mainnet vaults (no admin withdraw, 3-day timelock on rule changes): Robinhood Chain `0xMAINNET_RH_POOL` (deploy block `MAINNET_RH_BLOCK`), Tempo `0xMAINNET_TEMPO_POOL` (deploy block `MAINNET_TEMPO_BLOCK`). PoseidonT3 on both: `0x1a32C2c2A77225EC2dD3BF7be1018819b1039Cb4`. Owner and treasury `0x76b7E410a227c888aBD2Bdc24Ee32E094B0FD4D8` (one wallet at launch, multisig planned); relayer `0xb1E994586E62994648a0b866BF33F2EDd942512e` (Gloam team runs it; it cannot move or redirect money)
- Testnet vaults: Robinhood Chain `0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740`. Tempo `0x841dc046ea3cc842ba3a855731472c6eb0f2d5eb`. Drainable, never use or seed: `0x4F38…12D8F` (audit H-P1). Never product-default `0xA488…`

## Live

Mainnet (final keys, beta deposit limits: 500 per deposit and 25,000 total per stablecoin, $GLOAM 25,000 per deposit and 250,000 total) and the testnets (dev keys, test funds):

- Shield, private send, cash out, private payroll (one-off and scheduled), payment requests, the Gloam relay
- Mainnet assets: USDG and $GLOAM on Robinhood Chain; USDC.e, pathUSD, USDT0 and OUSD on Tempo. Deposits and private payments are free; a cash out costs 0.25%
- Proofs of funds, payment and payroll totals, checked at `/verify`
- Agent payments over x402 and MPP, MCP server with spending limits
- Stock tokens held and sent privately on the Robinhood Chain testnet (testnet only)
- Private trade (sealedSwap) is built but switched off on every network while we build a new engine for private trading
- App root: `app/` · never revive `docs.gloam.trade`

## Audits

- Reviews so far are internal: two rounds with fixes deployed, then the pre-mainnet review of 20 October 2026, closed with no Critical or High findings open. The multi-party ceremony is done (13 contributors, drand round 6561386, release `ceremony-final`). An external audit is planned, not done.

## Rules

- Real privacy (shielded balances, private txs). Never fake or mock success.
- **Public path** needs no Gloam contracts. **Private path** needs `contracts/`.
- Mainnet is the product (beta, real money); the testnets are the free practice network. Label real money and test funds plainly, and never let a mainnet path use dev keys.
- Two key sets: testnet verifiers hold the dev keys (`contracts/src/verifiers/*`, `app/public/circuits/*`), mainnet the ceremony's final keys (`contracts/src/verifiers/final/*`, `app/public/circuits/final/*`). Each network names its set (`GloamNetwork.ceremony`); a mainnet entry sets `"production"`. `script/KeyCheckProofs.sol` (regenerate with `node contracts/circuits/scripts/gen-key-fixtures.mjs`) proves which keys a verifier holds.
- Brand: monochrome with a green tint (`#2e7d53` light, `#8fd3ad` dark), Aeonik, light and dark. Calm, spacious, plain-language.
- Secrets server-side only.
- If it does not serve private payments for people, teams and agents on Tempo and Robinhood Chain, it waits.
- Docs live in-app (`app/src/app/docs`). Do **not** create a separate docs project or `docs.gloam.trade`.
- Commit = commit + push to `main` for product work.
