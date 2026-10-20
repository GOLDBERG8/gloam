# Gloam

**Thesis: Stablecoins are becoming how businesses and AI agents pay each other, and every one of those payments is public. Gloam makes them private, and lets the payer prove exactly what someone needs to see.**

Tagline: private by default, provable on demand. Hero line: private money on public chains.

- Lead with stablecoin payments, payroll and agent payments, on Tempo and Robinhood Chain testnets.
- Why the tech fits: a payment has one owner, so the owner proves it on their own device with zero-knowledge proofs and nobody else holds a key. Committee systems (Zama FHE, Arcium MPC) and operator systems (Tempo Zones) suit shared secrets, not single-owner payments.
- Not new cryptography: the Zcash-lineage pool. New, as far as our research found: the payroll total proof, proofs scoped to one reader with an expiry (`context` input), and private payments for agents (MPP method proposal, x402, MCP with spending limits).
- Stock tokens on Robinhood Chain: held and sent privately today. Private trade is built and switched off on-chain while we build a new engine for private trading. No dates.
- Never claim "first" or "only". Never say mainnet is live. Never mention a Gloam token. Say "no admin withdraw, timelocked rule changes", not "no admin" or "trustless".
- Comparison and honest gaps: `/docs/compare`, `/docs/privacy-model`, `/docs/production`.

## Canonical

- Domain: `gloam.trade` (single host)
- Docs: `gloam.trade/docs`
- Whitepaper: `gloam.trade/whitepaper`
- Pitch deck: `gloam.trade/pitch` (source `app/public/pitch/index.html`; `pitch/gloam-deck.html` is a repo copy, keep them in sync)
- Testnet product: `gloam.trade/app` (future host: `testnet.gloam.trade`)
- X: `@gloamtrade`
- Vercel: one project, Root Directory = `app`
- Contracts: `contracts/` (Foundry), ShieldPoolPoseidon vault on Robinhood Chain testnet (`46630`) and Tempo Moderato testnet (`42431`)
- Robinhood Chain vault (no admin withdraw, 3-day timelock on rule changes): `0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740`. Tempo vault: `0x841dc046ea3cc842ba3a855731472c6eb0f2d5eb`. Drainable, never use or seed: `0x4F38…12D8F` (audit H-P1). Never product-default `0xA488…`

## Live on testnet (dev keys)

- Shield, private send, cash out, private payroll (one-off and scheduled), payment requests, the Gloam relay
- Proofs of funds, payment and payroll totals, checked at `/verify`
- Agent payments over x402 and MPP, MCP server with spending limits
- Stock tokens held and sent privately on Robinhood Chain
- Private trade (sealedSwap) is built but switched off on-chain while we build a new engine for private trading
- App root: `app/` · never revive `docs.gloam.trade`

## Audits

- Audits so far are internal (two rounds, fixes deployed). An external audit and a multi-party ceremony come before mainnet.

## Rules

- Real privacy (shielded balances, private txs). Never fake or mock success.
- **Public path** needs no Gloam contracts. **Private path** needs `contracts/`.
- Product is **testnet-only** until the mainnet deploy. No mainnet mix-in.
- Two key sets: testnet verifiers hold the dev keys (`contracts/src/verifiers/*`, `app/public/circuits/*`), mainnet the ceremony's final keys (`contracts/src/verifiers/final/*`, `app/public/circuits/final/*`). Each network names its set (`GloamNetwork.ceremony`); a mainnet entry sets `"production"`. `script/KeyCheckProofs.sol` (regenerate with `node contracts/circuits/scripts/gen-key-fixtures.mjs`) proves which keys a verifier holds.
- Brand: monochrome with a green tint (`#2e7d53` light, `#8fd3ad` dark), Aeonik, light and dark. Calm, spacious, plain-language.
- Secrets server-side only.
- If it does not serve private payments for people, teams and agents on Tempo and Robinhood Chain, it waits.
- Docs live in-app (`app/src/app/docs`). Do **not** create a separate docs project or `docs.gloam.trade`.
- Commit = commit + push to `main` for product work.
