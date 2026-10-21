# Deploy (Vercel)

One project. One domain. Docs live on the same app.

## Marketing + docs (`gloam.trade`)

| Field | Value |
| --- | --- |
| Root Directory | **`app`** |
| Framework | **Next.js** (auto) |
| Build Command | `pnpm run build` (or leave default) |
| Output Directory | **Leave empty** (do not set `.next`) |
| Install Command | `pnpm install` |
| Node | 20+ |

If Root Directory is the repo root instead of `app`, Vercel looks for `.next` at `/vercel/path0/.next` and fails with `ENOENT ... package.json`.

## Routes

| Path | Content |
| --- | --- |
| `/` | Landing |
| `/app` | The product: mainnet and the free practice testnet, switched in-app |
| `/app/trade?path=sealed` | Private trade (switched off on every network) |
| `/pitch` | Pitch deck |
| `/docs` | Docs overview (Arrow-style) |
| `/docs/*` | encryption, privacy-model, chain, product |
| `/whitepaper` | Whitepaper |
| `/terms` `/privacy` `/cookies` `/disclosures` | Legal |

## Domains

- `gloam.trade` / `www` → this project (landing + `/docs` + `/app`)
- **No** `docs.gloam.trade` (use `/docs`)
- Product: `gloam.trade/app` (mainnet and testnet)
- Later: point `testnet.gloam.trade` at the same project (rewrite `/` → `/app` or keep path). No second codebase required.

## Docs

Canonical docs live in the app at `app/src/app/docs` and `app/src/app/whitepaper` (served from `gloam.trade/docs`). The old standalone `docs/` package was legacy and has been removed.

## Mainnet (deploy day)

Mainnet pools are not env vars. After each mainnet deploy (runbook: [`contracts/PRODUCTION.md`](./contracts/PRODUCTION.md)), fill `MAINNET_POOLS` in `app/src/lib/mainnet.ts` with the pool address and its deploy block; the deploy script prints both. Until a chain has both, that mainnet is hidden everywhere: the app, the API, the relay, the MCP server, Glim and proofs. The site says mainnet is live once the launch time (`MAINNET_LAUNCH_ISO`, 21 October 2026, 13:00 UTC) has passed and at least one pool is in. The SDK keeps its own `MAINNET_POOLS` in `@gloamtrade/sdk`.

| Network | Pool (`ShieldPoolPayments`) | Deploy block |
| --- | --- | --- |
| Robinhood Chain mainnet `4663` | `0xMAINNET_RH_POOL` | `MAINNET_RH_BLOCK` |
| Tempo mainnet `4217` | `0xMAINNET_TEMPO_POOL` | `MAINNET_TEMPO_BLOCK` |

| Variable (server only) | Value |
| --- | --- |
| `GLOAM_RPC_URL_4663` | A private Robinhood Chain mainnet RPC. The server tries it first, then the public `https://rpc.mainnet.chain.robinhood.com` |
| `GLOAM_RPC_URL_4217` | A private Tempo mainnet RPC. The server tries it first, then the public `https://rpc.tempo.xyz` |

Never put these behind `NEXT_PUBLIC_`. The same `GLOAM_RPC_URL_<chainId>` works for the testnets.

## Testnet vault env (optional)

Defaults are hard-coded for the current Robinhood Chain testnet vault. You do not need these env vars.

| Variable | Correct value | Do not set |
| --- | --- | --- |
| `NEXT_PUBLIC_POSEIDON_SHIELD_POOL` | `0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740` | `0x4F38…12D8F` (drained, audit H-P1; the app does NOT remap it). `0xAc25…`, `0xaEbB…`, `0xA488…` (superseded; the app remaps them, but a clean env is better) |
| `NEXT_PUBLIC_SHIELD_DEPLOY_BLOCK` | `126185021` | `90260331`, `110840714`, `120461692` (superseded pool history) |
| `NEXT_PUBLIC_HASH_SCHEME` | `poseidon` | `keccak` unless debugging Phase-1 |

**Hygiene:** omit these envs entirely if the hard-coded defaults are fine. A superseded pool address or deploy block is remapped at runtime; for the pre-sealed `0xA488…` and block `90260331`, Settings → vault health also shows a remapped warning.

Admin: `ADMIN_ACCESS_CODE` (server-only).
