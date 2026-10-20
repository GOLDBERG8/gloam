# Security notes (Gloam testnet)

## Secrets policy

| Do | Don't |
| --- | --- |
| Put `DEPLOYER_PK` only in shell env / CI secrets | Commit private keys, mnemonics, or `.env` |
| Use public contract addresses in app defaults | Put funded mainnet keys anywhere in the repo |
| Keep the testnet zkeys labeled **dev** and the mainnet ones in `circuits/final` | Use dev keys or dev verifiers for real money |

## Secret scanners / git guard false positives

These are **not** private keys:

- `app/public/circuits/*.zkey` / `*.wasm` — public proving artifacts (dev keys, testnet)
- `app/public/circuits/final/*` — public proving artifacts (the ceremony's final keys, mainnet)
- `contracts/script/KeyCheckProofs.sol` — public test proofs, no secrets
- `contracts/deployments/*.json` — public addresses + explorer URLs
- `contracts/test/fixtures/*` — Poseidon bytecode for unit tests
- Long `0x…` hex that is a **transaction hash** or **contract address**

Allowlist: [`.gitleaks.toml`](./.gitleaks.toml)

If a scanner still flags a **public** tx hash or zkey, mark as false positive. If it flags a 64-byte hex that is a real private key, **rotate immediately** and purge history.

## Vault notes

- Notes (secrets) and receive keys live in the browser, encrypted at rest under a non-extractable device key, or under a passkey if the user turns that on.
- Settings → backup: plain JSON or passphrase-locked (`gloambak1.…`). Recovery keeps an end-to-end encrypted copy that only the user's wallet signature or passkey can open.
- Anyone with an unlocked backup can spend those notes.
- Who can do what, and the assumptions behind it: [gloam.trade/docs/threat-model](https://gloam.trade/docs/threat-model).

## Reporting a vulnerability

Thank you for looking. Please report privately; don't open a public issue or post details until a fix ships.

- **Where:** email [hello@gloam.trade](mailto:hello@gloam.trade) with "Security" in the subject, or DM [@gloamtrade](https://x.com/gloamtrade). A machine-readable contact is at [gloam.trade/.well-known/security.txt](https://gloam.trade/.well-known/security.txt).
- **What helps:** the affected contract, route or page, exact steps or a proof of concept, and the impact you saw. Tests on a fork or a local chain are ideal.
- **What's in scope:** the vault and verifier contracts, the circuits, the app and API at gloam.trade, the relay, the SDK and the MCP server.
- **Please don't:** run attacks that degrade the service for others, touch other people's data or notes, or use social engineering.
- **What to expect:** we aim to reply within 3 days, keep you updated, and credit you once it's fixed if you'd like that.
- **Rewards:** Gloam is testnet only and does not run a paid bug bounty yet. We'll say so here when that changes.

Past reviews and every finding with its status: [`contracts/audit/REMEDIATION.md`](./contracts/audit/REMEDIATION.md).
