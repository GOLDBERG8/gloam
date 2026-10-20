# Shield architecture (v2, Poseidon vault)

## Goal

Private hold, move and pay on **Robinhood Chain testnet** (`46630`) and **Tempo Moderato testnet** (`42431`). Private trade is built but switched off pending audit. Testnet only; mainnet is not live.

## Contract surface

```
User wallet
    │
    ├─ public path ──► ETH / ERC-20 / DEX (no Gloam contracts)
    │
    └─ private path ─► ShieldPoolPoseidon ──► DualProofVerifier
                           │                      ├ UnshieldIVerifier (5 inputs)
                           │                      └ TransferIVerifier (4 inputs)
                           ├ shieldBound ────────► ShieldIVerifier (3 inputs)
                           ├ sealedSwap ─────────► sealedSwapVerifier = 0x0 (disabled)
                           ├ commitments (Poseidon Merkle leaves)
                           ├ spent nullifiers
                           └ currentRoot

GloamPayMemo: encrypted payment memos for discovery. Holds no funds.
```

## Owner powers

- **No admin withdraw.** No function moves note-backed funds; notes leave only through a proof-gated `unshield()` to the recipient bound in the proof. `sweepStrayNative()` can only take native currency above `deposited[address(0)]`, i.e. ETH sent straight to the contract that backs no note.
- **Timelocked rule changes.** Setters that affect proof validity, pricing or asset flows (`setVerifier`, `setSealedSwapVerifier`, `setShieldVerifier`, `setSwapRate`, `setPriceFeed`, `setOracleConfig`, `setOracleRatePair`) run directly only during setup. `setupMode()` is `false` on both live pools, so every change goes `queueChange` → public `CHANGE_DELAY` (3 days) → `executeChange` within a 14-day grace window. The owner wallet can still swap verifiers this way; the delay is what gives users time to see it and cash out.
- **Two-step ownership** (`transferOwnership` + `acceptOwnership`). On testnet the owner is a single wallet; a multisig is an open mainnet decision.

## Live deploy (current pools, redeployed 2026-09-29)

**Robinhood Chain testnet `46630`.** Record: [deployments/poseidon-testnet.json](./deployments/poseidon-testnet.json).

| | |
| --- | --- |
| Pool (product) | `0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740` |
| Deploy block | `126185021` |
| DualProofVerifier | `0xB077c620384813bB31Bb82Cd55b63608Ac20f7eF` |
| ShieldIVerifier | `0x28E6d0D02568EE634f9596645775275DE76b2847` |
| sealedSwapVerifier | `0x0` (private trade off) |
| GloamPayMemo | `0x689ebd9d30E0235c73fd8f10236F850CDB3c5DCE` (first deploy; its event still indexes the poster, so relayed memos are the only way to keep the sender off it) |

**Tempo Moderato testnet `42431`.**

| | |
| --- | --- |
| Pool (product) | `0x841DC046Ea3CC842BA3A855731472c6Eb0F2d5eb` |
| Deploy block | `37411195` |
| DualProofVerifier | `0x82F4eCE6533e48574914bEDEb55A8242Bc1A03A2` |
| ShieldIVerifier | `0x7836A07d6a5f1F09c91B343161152133924E6Eb3` |
| sealedSwapVerifier | `0x0` (private trade off) |
| GloamPayMemo | `0x3ca88712e9219b5EE4c82D31cAfEaB64C9E9b4E3` (fixed source, no poster in the event) |

Both: hash Poseidon, proof layout v2, Groth16 on BN254, keys from a **single-contributor dev ceremony** (testnet only). Mainnet deploys `ShieldPoolPayments` with the multi-party ceremony's final keys (`src/verifiers/final`).

### Superseded pools (history only)

These remain on-chain but are no longer used. **The app must not default to them** (`app/src/lib/config.ts` remaps a stale env that points at one).

| Network | Pool | Note |
| --- | --- | --- |
| RH `46630` | `0xAc25c3C4A880194324d1fC78722694e0F315aF1c` | 2026-09-16 hardened pool, superseded 2026-09-29 |
| RH `46630` | `0xaEbB8E3b5C4648Aa7Cc4E41d3Cec008Db4bb1834` | 2026-09-01 C1/C2/C3 pool, superseded 2026-09-16 |
| RH `46630` | `0x4F38…12D8F` | Pre-C1 pool, drained (audit H-P1). Never use or seed |
| RH `46630` | `0xA488809a089F003A2B6E69daa65B0db79823c93B` | Legacy Poseidon, pre-sealed |
| RH `46630` | `0x2BD98196D90AB45D58843B4c8B8809aa34343d35` | Phase-1 keccak pool |
| Tempo `42431` | `0xeD0b0F8eE6206eCd87cF47Fc1C5220d15C6e2276` | 2026-09-16 hardened pool, superseded 2026-09-29 |
| Tempo `42431` | `0x3eeE869aFF476D90aF6CF0bC8F0b450C98A8D30b` | First Tempo pool |

Older verifier deployments (for example `DualProofVerifier 0x4B0D…949C`, `SealedSwapVerifier 0xE19a…dF8D`) belonged to superseded pools.

## Phases (status)

| Phase | What | Status |
| --- | --- | --- |
| 0 | Interfaces + scaffold | Done |
| 1 | Keccak pool, shield only | Superseded (history only) |
| 2 | Poseidon pool, bound shield + unshield + transfer, dual verifier | **Live on testnet (dev keys)**, RH + Tempo |
| 2b | No admin withdraw, timelocked rule changes | **Live on testnet** since 2026-09-29 |
| 3a | Vault trade adapter (unshield → DEX → reshield) | In the app where a public pool exists; size is public on the swap edge |
| 3b | Sealed-size private trade | **Built, switched off pending audit** (`sealedSwapVerifier = 0`); see [SEALED_TRADE.md](./SEALED_TRADE.md) |
| 4 | Off-chain proofs: funds, payment, payroll total | **Live on testnet**, verified at gloam.trade/verify |
| Prod | Multi-party ceremony + external audit + mainnet | Blocked, see [PRODUCTION.md](./PRODUCTION.md) |

## Note scheme (Poseidon)

```
commitment = Poseidon(secret, amount, asset)
nullifier  = Poseidon(secret, commitment)
Merkle     = Poseidon(left, right)  // depth 20
```

| Piece | Location |
| --- | --- |
| Circuits (all seven) | `circuits/`, see [circuits/README.md](./circuits/README.md) |
| Dual verifier | `src/verifiers/DualProofVerifier.sol` |
| Shield verifier | `src/verifiers/Shield*.sol` |
| Sealed swap verifier (not wired) | `src/verifiers/SealedSwap*.sol` |
| Pool core (deposits, transfers, withdrawals, deposit limits) | `src/ShieldPoolCore.sol` |
| Testnet pool (core + sealed swap) | `src/ShieldPoolPoseidon.sol` |
| Mainnet pool (core only) | `src/ShieldPoolPayments.sol` |
| Timelock | `src/lib/ChangeTimelock.sol` |
| App artifacts | `app/public/circuits/*.wasm` + `*_final.zkey` |

### Proof public inputs (v2)

**Shield (3):** `[commitment, amount, asset]`  
**Unshield (5):** `[root, nullifier, asset, amount, to]`  
**Transfer (4):** `[root, nullifier, newC0, newC1]`  
**Sealed swap (9, disabled):** `[root, nullifier, newCOut, newCChange, assetIn, assetOut, amountOutMin, rateIn, rateOut]`  

If private trade is re-enabled, the app's privacy default publishes `amountOutMin = 1` so size is not leaked as min-out (see `app/src/lib/privacy.ts`).

## App integration

```
app/src/lib/config.ts          → current pool default (remaps superseded pools)
app/src/lib/networks.ts        → per-network pool, deploy block, memo board
app/src/lib/shield.ts          → ABI, local notes, gas limits
app/src/lib/noteVault.ts       → notes encrypted at rest
app/src/lib/treeSync.ts        → rebuild from Shielded + Transferred + SealedSwapped
app/src/lib/proveClient.ts     → browser snarkjs
app/.../ShieldView.tsx         → deposit (shieldBound)
app/.../MoveView.tsx           → private send + cash out
app/.../SealedTradePanel.tsx   → private trade (shows offline while disabled)
app/.../VaultTradePanel.tsx    → via-market adapter
```

## Scripts

```bash
# Inventory seed (faucet stocks into vault for cash-out solvency).
# Only relevant once private trade is re-enabled.
forge script script/SeedVaultInventory.s.sol --rpc-url $RH_TESTNET_RPC --broadcast
```
