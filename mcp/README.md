# @gloamtrade/mcp

Private stablecoin payments for AI agents on Tempo and Robinhood Chain, powered by [`@gloamtrade/sdk`](../packages/sdk). The agent pays x402 and MPP resources, holds a shielded balance and gets paid, within spending limits it cannot lift: off-chain limits this server checks, and on Tempo an access key whose cap the protocol enforces.

Live on mainnet (beta, real money) on Tempo (`4217`) and Robinhood Chain (`4663`), and on testnet for free practice. Robinhood gives agents an MCP server for **public** trading. Gloam gives them one for **private** payments, so who an agent pays, and how much, stays off the public chain.

## Mainnet or testnet

Every tool that touches a chain takes a `network`:

| `network` | What it is | Assets | Keys |
| --- | --- | --- | --- |
| `tempo-mainnet` | Tempo mainnet, real money | USDC.e, pathUSD, USDT0, OUSD | Final ceremony keys |
| `robinhood-mainnet` | Robinhood Chain mainnet, real money | USDG, GLOAM | Final ceremony keys |
| `tempo` | Tempo testnet (Moderato), test funds | PathUSD and other test stablecoins | Dev keys |
| `robinhood` | Robinhood Chain testnet, test funds | Test ETH, test USDG | Dev keys |

`GLOAM_NETWORK` sets the network a tool uses when the agent names none. Unset, it is `robinhood` (testnet), as in earlier versions, so an existing setup never starts moving real money by itself. For mainnet, set `GLOAM_NETWORK=tempo-mainnet` (or `robinhood-mainnet`) and give the agent mainnet limits (see [Mainnet assets in limits](#mainnet-assets-in-limits)). A price an agent pays names its own network, and the server pays there only if that network is one it has a pool for.

On mainnet:

- **Payments only, beta limits.** The mainnet pools take deposits, private payments and sweeps. Private trading is not live. A deposit is at most 500 of a stablecoin (25,000 GLOAM) during the beta, checked before anything is proved; private payments are never limited.
- **Fees.** Deposits and private payments are free. Cashing out costs 0.25% (this server does not cash out; use the Gloam app or the SDK).
- **Final keys.** Proofs for mainnet use the final keys of the 13-contributor trusted setup, downloaded from `https://www.gloam.trade/circuits/final` and checked against the SHA-256 the SDK pins. Testnet proofs use the dev keys. The two are cached apart.
- **Beta software.** The contracts and circuits were reviewed internally before launch with no Critical or High findings open; an external audit is planned, not done. The mainnet pools are new, so the crowd of notes to hide among is small at first. Start with small amounts.
- **Pools come with the version.** A mainnet appears here once the SDK this package ships with has its pool. If `GLOAM_NETWORK` names a mainnet this version lacks, the server stops at startup and says so.
- **Your own RPC.** `GLOAM_RPC_URL_4217` and `GLOAM_RPC_URL_4663` point Tempo and Robinhood Chain mainnet at another RPC (any chain id works the same way).

## Install

One command per client. The server speaks MCP over stdio and needs Node.js 20 or newer.

```bash
claude mcp add gloam -- npx -y @gloamtrade/mcp          # Claude Code
codex mcp add gloam -- npx -y @gloamtrade/mcp           # Codex
code --add-mcp '{"name":"gloam","command":"npx","args":["-y","@gloamtrade/mcp"]}'   # VS Code
```

Any other client (Claude Desktop, Cursor, Gemini CLI, Windsurf):

```json
{ "mcpServers": { "gloam": { "command": "npx", "args": ["-y", "@gloamtrade/mcp"] } } }
```

As a plugin, with the skills that teach the agent to use it safely: `claude plugin marketplace add cryptoduke01/gloam-plugins`, then `claude plugin install gloam@gloam` (Codex and Cursor too, see [integrations/plugins](../integrations/plugins)).

Nothing to install: paste `https://www.gloam.trade/mcp` into Claude (Settings, Connectors, Add custom connector), ChatGPT, Cursor or any client that connects by URL. That hosted server only reads and plans (networks, vault stats, payment request links, proof checks, MPP how-to) and never takes a key; to sign and pay, run this one.

With no settings the server reads and plans and never signs. To let the agent spend, give it a key and limits in `~/.gloam/agent.env`. The safest way, on Tempo, is an access key the owner's wallet caps onchain:

```bash
npx -y @gloamtrade/mcp authorize-access-key --network tempo-mainnet --owner 0xYOUR_TEMPO_ACCOUNT --generate --limit 10 --period 1d --expires 30d
```

That makes the agent's key, saves it with matching off-chain limits and `GLOAM_NETWORK=tempo-mainnet`, and prints what the owner signs. To practice first with test funds, use `--network tempo`. See [Onchain limits with a Tempo access key](#onchain-limits-with-a-tempo-access-key).

### Settings

The server reads its environment, then `~/.gloam/agent.env` (or the file in `GLOAM_ENV_FILE`). The environment wins, and only `GLOAM_*` lines are read from the file. Keep keys in that file (mode 600), not in an MCP client config. `npx -y @gloamtrade/mcp --help` lists the main settings.

| Setting | Meaning |
| --- | --- |
| `GLOAM_NETWORK` | Default network for tools: `tempo-mainnet`, `robinhood-mainnet` (real money), `tempo` or `robinhood` (testnet). Default `robinhood`. A mainnet here also puts the Tempo access key on Tempo mainnet |
| `GLOAM_AGENT_PRIVATE_KEY` | The agent's key. Without it the execute tools return plans |
| `GLOAM_TEMPO_ACCOUNT` | The owner's Tempo account. With it, the key is a Tempo access key acting for that account |
| `GLOAM_TEMPO_FEE_TOKEN` | Token to pay Tempo fees in, in access-key mode. Default: the protocol's choice |
| `GLOAM_NOTE_KEY` | Note store key (see [Notes stay in the server](#notes-stay-in-the-server)) |
| `GLOAM_LIMIT_*`, `GLOAM_LIMITS_FILE` | Off-chain spending limits (see [Spending limits](#spending-limits)) |
| `GLOAM_ENV_FILE` | Where the settings file is. Default `~/.gloam/agent.env` |
| `GLOAM_RPC_URL_<chainId>` | Another RPC for one network, e.g. `GLOAM_RPC_URL_4217` for Tempo mainnet |
| `GLOAM_MPP_SECRET_KEY` (or `MPP_SECRET_KEY`) | Key that binds the MPP challenges this server issues (at least 32 characters; the same key an mppx server uses). Default: derived from the note store key |

## Tools

| Tool | Type | What it does |
| --- | --- | --- |
| `gloam_info` | read | What Gloam is, its networks, and what the agent can do |
| `gloam_privacy_status` | read | Honest posture: what is public, what is private, mainnet limits and fees, how thin the anonymity set is |
| `gloam_list_markets` | read | Markets planned for private trading, with indicative testnet marks. Private trading is not live |
| `gloam_quote` | read | Indicative quote for a future private trade |
| `gloam_plan_private_trade` | plan | Describe a private trade (never executes; private trading is off) |
| `gloam_plan_shield` | plan | Describe a shield before executing (no signing) |
| `gloam_execute_shield` | execute | **Real private deposit** on the chosen network. Mints a note, generates the Groth16 proof server-side with that network's keys, broadcasts `shieldBound()`, and returns a note handle |
| `gloam_execute_transfer` | execute | Public transfer of test ETH on Robinhood Chain testnet (funding while practicing). Amount and recipient are visible |
| `gloam_list_notes` | read | This server's notes as handles (network, asset, amount, status, creating tx) and the private balance per asset. `refresh` checks pending notes on chain |
| `gloam_receive_tag` | read | This server's receive tag (`gloamr1.…`), for others to pay it. Created on first use |
| `gloam_payment_requirements` | server | Price an agent resource in a private payment; returns the x402 requirements and the MPP challenge (`mpp.wwwAuthenticate`). `payTo` defaults to this server's receive tag |
| `gloam_pay_x402` | agent | Plan the private payment that satisfies a 402 challenge (x402 or MPP) |
| `gloam_execute_private_pay` | execute | **Real private payment** from a note handle: sync, prove, broadcast `transfer()`, keep the change. Returns the `X-PAYMENT` header, or for an MPP challenge the `Authorization: Payment` credential |
| `gloam_fetch_paid` | execute | Fetch a URL; on a Gloam 402 (MPP method `gloam`, or x402), pay privately and retry, all inside the server. Returns the response and, for MPP, the decoded `Payment-Receipt` |
| `gloam_verify_payment` | server | Open a presented payment (x402 or MPP) with this server's receive key, verify it, sweep it into a fresh note, and say whether to grant access |
| `gloam_get_limits` | read | This agent's spending limits: tools, assets, per payment, per day, recipients, expiry |
| `gloam_get_spending_report` | read | Spent and left in the last 24 hours per asset, recent payments, refused attempts |

`gloam_execute_shield` is the private-execution rail: the agent ends up with a shielded balance only this server can spend. The agent sees a note handle such as `n-k3x9p2qw7m`, never the note's secret. When no signer is configured, every execute tool returns a plan instead of acting, and we never return a fake private fill.

The x402 tools are private agent payments (the MCPay pattern, but the settlement is private). `gloam_payment_requirements` prices a resource to the payee's receive tag. The paying agent calls `gloam_execute_private_pay` (or `gloam_fetch_paid` for the whole request), which settles a private send and seals the payment note to that tag, so only the payee can open it. The payee calls `gloam_verify_payment`, which opens the note, checks it binds the required amount and asset, and sweeps it into a fresh note before saying `grantAccess: true`. Unlike a Tempo Zone, no operator sees the transaction: it is private from the public and self-custodial, with an optional per-payment issuer-scoped compliance disclosure. See `TEMPO_EXPANSION.md`.

## Notes stay in the server

A private balance is a note, and whoever knows a note's secret can spend it. So the secrets never go to the agent. They live in an encrypted file inside this server, and the tools hand out handles plus facts that are not secret: network, asset, amount, status (`unspent`, `pending`, `spent`) and the transaction that created the note.

- `gloam_execute_shield` stores the minted note before anything is broadcast, then marks it unspent once the deposit confirms. If the deposit never goes out, the note is dropped.
- `gloam_execute_private_pay` takes a handle (or picks the smallest note that covers the price), reserves it so no other call can spend it at the same time, and stores the change as a new note. On success the input is marked spent. If nothing was broadcast, the input is spendable again. If a transaction went out but its result is unknown, both stay pending until `gloam_list_notes` with `refresh` settles them.
- A payment spends one note. Notes are not combined, so a balance split across small notes may not cover one large payment.

| Setting | Meaning |
| --- | --- |
| `GLOAM_NOTE_KEY` | 32 random bytes in hex (`openssl rand -hex 32`). The store key. Recommended, and required for a server with no signer |
| (unset) | The store key is derived from `GLOAM_AGENT_PRIVATE_KEY` with HKDF-SHA256 under a Gloam note-store label, so it is never the signing key itself |
| `GLOAM_NOTE_STORE` | Where the store lives. Default `~/.gloam/notes.<agent>.json` |
| `GLOAM_EXPOSE_NOTE_SECRETS=1` | **Unsafe, legacy only.** Brings back the old behavior: shield and pay return note secrets, pay accepts `noteSecret`, and a `payTo` that is not a receive tag is paid with an unsealed note. Off by default. Read once at startup |

The store is AES-256-GCM over the whole file (amounts and counts are hidden too), bound to the agent id, written with mode `0600` under the same kind of lock as the spending log. A store that does not decrypt is never overwritten, since it holds the only copy of the money: fix the key or move the file. Back it up together with its key. Changing `GLOAM_NOTE_KEY`, or the signer when the key is derived, makes an existing store unreadable until the old key is back.

## Getting paid: sweep before you serve

In x402 the payer builds the payment note, so the payer knows its secret too. If a server served right after checking the payment, the payer could spend the note back before the server moved it. `gloam_verify_payment` closes that gap:

1. It opens the sealed note with this server's receive key (a note sealed to anyone else does not open).
2. It checks the note binds the required amount and asset, is the payment output of the presented transfer, and sits in Gloam's pool on that network (requirements naming any other pool are refused).
3. It sweeps the note: a private transfer of the whole amount into a fresh note only this server knows. The fresh note is stored before the sweep is sent.
4. Only when the sweep confirms does it return `grantAccess: true`. If the payer already spent the note, the sweep cannot land and the answer is `already_spent`. The same header presented twice gets `already_settled`.

The sweep is signed by `GLOAM_AGENT_PRIVATE_KEY`, or sent through the Gloam relay with `GLOAM_USE_RELAY=1` (or `GLOAM_RELAY_URL`), so a payee needs no gas and its wallet never appears. With neither, the answer is `verified_not_final` and `grantAccess: false`. The sweep is not a spend under the limits: it can only move money this server just received into a note this server holds.

## MPP (Machine Payments Protocol)

The payment tools also speak [MPP](https://mpp.dev): `402` with `WWW-Authenticate: Payment …`, a retry with `Authorization: Payment …`, and a `Payment-Receipt`. Gloam is an MPP payment method, `gloam` with intent `charge` ([spec draft](../docs/mpp/draft-gloam-charge-00.md), library [`@gloamtrade/mppx-gloam`](../packages/mppx-gloam) for mppx servers and clients). The settlement is the same private send as x402, so spending limits, the note store and the sweep work exactly as above.

- **Paying.** `gloam_fetch_paid` reads `WWW-Authenticate`; when it offers `method="gloam"` it pays that (it is preferred over x402 when both are offered), retries with the credential in the field the challenge selects, and returns the decoded receipt. `gloam_execute_private_pay` takes the challenge (the `WWW-Authenticate` value) as `requirements` and returns `authorization`. This server pays in push mode (it broadcasts its own transfer); a challenge that only accepts pull, or with less than 30 seconds left, is refused before anything is proved.
- **Getting paid.** `gloam_payment_requirements` returns `mpp.wwwAuthenticate` next to the x402 requirements: an HMAC-bound challenge, valid for 10 minutes by default (`expiresInSeconds`). Pass the presented `Authorization` value to `gloam_verify_payment` as `payment`. It checks that this server issued the challenge, that it has not expired, that the credential is bound to that challenge, and that the payment note is the payment output of a `Transferred` event in Gloam's pool; then it sweeps as above. For a pull credential (the payer hands over its proven transfer instead of broadcasting it) it submits the transfer first. On `grantAccess: true`, serve with `paymentReceipt` as the `Payment-Receipt` header. Passing the challenge you issued as `requirements` also binds the credential to that exact price.

## Spending limits

An agent that can sign can spend, so every tool that moves money checks the owner's limits first: `gloam_execute_private_pay` and `gloam_fetch_paid` (pay), `gloam_execute_transfer` (send) and `gloam_execute_shield` (shield). A spend that breaks a limit is refused before anything is proved or signed, with a plain reason the agent can act on, for example:

```json
{ "status": "refused", "code": "over_daily",
  "message": "That would bring the last 24 hours to 14 PathUSD, over the limit of 12 PathUSD a day. 2 PathUSD is left right now. More frees up from 2026-10-04T12:00:00.000Z." }
```

**No limits, no spending.** With a signer but no limits configured, every spend is refused. To run without limits on purpose, set `GLOAM_LIMITS=off` (spends are still logged).

### Where the limits are enforced

In two layers.

1. **Off-chain, by this MCP server, before it signs.** These are the limits below. The vault contract does not know about them. They bind the agent as long as its key is held only by this server; anyone who has the key directly is not bound.
2. **Onchain, by Tempo, with an access key.** When the key is a Tempo access key (`GLOAM_TEMPO_ACCOUNT`), the owner's AccountKeychain authorization caps what the key can move out of the owner's account each period, limits what it may call, and sets when it stops working. The protocol checks that on every transaction, so it holds even if this server, its host or the key itself is compromised. See [Onchain limits with a Tempo access key](#onchain-limits-with-a-tempo-access-key).

Use both: the off-chain limits give the agent per-payment caps, recipient lists and readable refusals; the onchain cap is the boundary that does not depend on this server behaving.

### What is protected, and what is not

Protected now:

- **The agent never holds a secret.** Note secrets stay in the server's encrypted store; the agent works with handles. A prompt-injected agent cannot paste a secret it never saw. Tests check that no tool result carries a note secret or a receive key.
- **Payments are sealed to the payee.** The payment note in the `X-PAYMENT` header is encrypted to the payee's receive tag, so the agent, a proxy or a log that sees the header cannot open it. A `payTo` that is not a receive tag is refused.
- **A payer cannot take a payment back.** `gloam_verify_payment` sweeps every payment into a fresh note before it grants access, and refuses when the note was already spent.
- **Limits still gate every spend** before anything is proved or signed, exactly as before.

Not protected:

- **Spending inside the limits.** A tricked agent can still pay an allowed recipient up to its caps. Keep `recipients` narrow and the caps small.
- **The host.** Whoever can read the store and its key (`GLOAM_NOTE_KEY`, or the signer key it is derived from) controls the notes. Treat the store and the key as money, keep the key out of the agent's reach, and back both up.
- **The resources it fetches.** `gloam_fetch_paid` returns the response body to the agent, and that body can carry its own prompt injection. The server will not fetch loopback, private, link-local or cloud-metadata addresses, including through a redirect (`GLOAM_FETCH_ALLOW_PRIVATE=1` lifts this for local testing); a host that changes its DNS answer between the check and the request is not fully covered.
- **A payment whose retry fails.** The header is returned so the agent can present it again with `gloam_fetch_paid` (`paymentHeader`) without paying twice. The payer keeps no copy of the payment note's secret, so a payment the payee never redeems cannot be pulled back.
- **Payers on older versions** may still send an unsealed note. The payee sweeps it the same way, but anyone who saw that header could race the sweep, in which case the payee refuses and the payer has lost it.
- **Legacy mode.** With `GLOAM_EXPOSE_NOTE_SECRETS=1` none of the first two points hold.

### What you can limit

| Limit | Meaning |
| --- | --- |
| `tools` | Which money tools the agent may use: `pay`, `send`, `shield`. Default all three |
| `assets` | Which assets it may move. Required, there is no "any" |
| `maxPerPayment` | Cap on a single payment, in the asset's units (e.g. `"5"` is 5 USDC.e) |
| `maxPerDay` | Cap over a rolling 24 hours, so a burst cannot straddle midnight |
| `recipients` | `"any"`, or a list of Gloam receive tags and `0x` addresses. Required. Shields go to the agent's own balance and skip this |
| `expiresAt` | After this the agent cannot spend. `"2026-12-31"` means through the end of that day (UTC); a full ISO timestamp is taken as written |

Assets are named by symbol or by `0x` token address (with `decimals` for a token Gloam does not know). Matching is by network and contract address, never by the symbol a payee writes into a 402 challenge, so a payment cannot slip through by relabeling a token. Private payments must also go through Gloam's own pool on that network.

| Network | Symbols |
| --- | --- |
| `tempo-mainnet` | `USDC.e`, `pathUSD`, `USDT0`, `OUSD` |
| `robinhood-mainnet` | `USDG`, `GLOAM` |
| `tempo` (testnet) | `PathUSD`, `OUSD`, `AlphaUSD`, `BetaUSD`, `ThetaUSD` |
| `robinhood` (testnet) | `ETH`, `USDG` |

### Mainnet assets in limits

Mainnet and testnet are different chains, so each limit is for one of them. A symbol on both sides (`USDG`, `pathUSD`, `OUSD`), or a token address on both (pathUSD and OUSD use the same address on Tempo mainnet and testnet), means the **testnet** asset unless the entry names a network. That way a config written for testnet never starts approving real money by itself. Mainnet-only symbols (`USDC.e`, `USDT0`, `GLOAM`) and the mainnet USDG address name the mainnet asset directly.

```json
{
  "agents": {
    "research-bot": {
      "recipients": ["gloamr1.MFkwEwYH...their-receive-tag"],
      "assets": {
        "USDC.e": { "maxPerPayment": "2", "maxPerDay": "20" },
        "pathUSD": { "network": "tempo-mainnet", "maxPerPayment": "2", "maxPerDay": "20" }
      }
    }
  }
}
```

With the environment variables, `GLOAM_LIMIT_NETWORK=tempo-mainnet` puts every asset in `GLOAM_LIMIT_ASSETS` on that network.

### Configure with a file (several agents)

Point `GLOAM_LIMITS_FILE` at a JSON file and pick the agent with `GLOAM_AGENT_ID` (default `default`). Each MCP server process runs as one agent. The file is read on every spend, so tightening a limit takes effect on the next call.

```json
{
  "agents": {
    "research-bot": {
      "tools": ["pay"],
      "recipients": ["gloamr1.MFkwEwYH...their-receive-tag"],
      "expiresAt": "2026-12-31",
      "assets": {
        "USDC.e": { "maxPerPayment": "5", "maxPerDay": "50" }
      }
    },
    "ops-agent": {
      "recipients": "any",
      "maxPerPayment": "250",
      "maxPerDay": "1000",
      "assets": {
        "USDG": { "network": "robinhood-mainnet" },
        "USDT0": {}
      }
    },
    "practice-bot": {
      "recipients": "any",
      "maxPerPayment": "5",
      "maxPerDay": "50",
      "assets": ["PathUSD", "USDG"]
    }
  }
}
```

The array form of `assets` uses the agent-level `maxPerPayment` and `maxPerDay` for each asset; the object form can set them per asset, or leave them out to use the agent's (an asset entry may also take `network` and, for an unknown token address, `decimals`). In the example, `research-bot` and `ops-agent` spend real money and `practice-bot` only test funds. A config that does not parse, names an unknown asset, or leaves out a cap is treated as no permission: every spend is refused with the reason.

### Configure with environment variables (one agent)

```bash
GLOAM_AGENT_ID=research-bot
GLOAM_LIMIT_ASSETS=USDC.e,pathUSD        # required
GLOAM_LIMIT_NETWORK=tempo-mainnet        # optional: the network of every asset above (else testnet for shared symbols)
GLOAM_LIMIT_MAX_PER_PAYMENT=5            # required, applies to each asset
GLOAM_LIMIT_MAX_PER_DAY=50               # required, applies to each asset
GLOAM_LIMIT_RECIPIENTS=any               # required: any, or a comma list
GLOAM_LIMIT_EXPIRES=2026-12-31           # optional
GLOAM_LIMIT_TOOLS=pay,shield             # optional
```

Use the file or the variables, not both.

### The spending log

Every spend is written to a local JSON file before it is signed (`~/.gloam/spend-log.<agent>.json`, or `GLOAM_SPEND_LOG`). The check and that reservation happen under a lock, so two calls at once, or two server processes sharing the log, cannot both squeeze under the daily cap. Each entry is then settled as `sent`, `unconfirmed` (broadcast, receipt unknown), `reverted` or `failed`. Pending, sent and unconfirmed count against the limit; failed, reverted and refused do not. Refusals are logged too, so you can see what an agent tried. If the log cannot be read, the agent cannot spend.

`gloam_get_limits` shows the limits as the server sees them, and `gloam_get_spending_report` shows spent and remaining for the last 24 hours, the recent payments and the recent refusals. When there is no signer, the execute tools still return a plan, now with a `limits` preview saying whether it would be allowed.

## Onchain limits with a Tempo access key

Off-chain limits stop an agent that misbehaves through this server. They cannot stop someone who has the key. On Tempo an access key closes that gap. The owner's wallet authorizes the agent's key in Tempo's AccountKeychain precompile (`0xAAAAAAAA00000000000000000000000000000000`) with:

- **an expiry**, after which the key cannot sign;
- **a spending limit per stablecoin** that resets every period (or a one-time total);
- **call scopes**: approve the Gloam pool, and only the pool, as spender of the capped stablecoins, and call `shieldBound` and `transfer` on the pool. Any other call is rejected, and an access key can never deploy a contract.

The server then signs Tempo transactions for the owner's account with that key, and the protocol checks the restrictions on every one. So **the caps hold even if the MCP server is compromised**: whoever holds the key can move at most what is left of the current period's limit out of the owner's account, only into the Gloam pool, and only until the key expires or the owner revokes it. The owner's root key never touches the agent's machine. The off-chain limits stay on as the second layer.

### Set it up

1. Make the key and print what the owner signs. Nothing is signed or sent, and the key is never printed:

   ```bash
   npx -y @gloamtrade/mcp authorize-access-key --network tempo-mainnet --owner 0xOWNER --generate --limit 25 --period 1d --expires 30d
   ```

   `--network` is `tempo-mainnet` (real money) or `tempo` (testnet). An access key is authorized on one chain, so a key made on testnet does nothing on mainnet. Left out, it is Tempo mainnet when `GLOAM_NETWORK` names a mainnet, else Tempo testnet. `--generate` writes the new key, `GLOAM_TEMPO_ACCOUNT`, a note-store key and matching off-chain limits to `~/.gloam/agent.env` (mode 600), keeping anything already there; on mainnet it also writes `GLOAM_NETWORK` and `GLOAM_LIMIT_NETWORK`. To authorize a key you already have, use `--key <address>` or leave both out to use `GLOAM_AGENT_PRIVATE_KEY`. `--limit 25` is in the network's default stablecoin (USDC.e on mainnet, PathUSD on testnet); repeat `--limit USDT0=10` for more stablecoins, use `--period once` for a total that never resets, and `--json` for machine-readable output. From a checkout: `pnpm --filter @gloamtrade/mcp authorize-access-key --owner ...`.

2. The owner authorizes it from their own wallet, with one of the three printed options:
   - Tempo Wallet or any Tempo Accounts SDK provider: the printed `wallet_authorizeAccessKey` request (passkey accounts).
   - Foundry: the printed `cast send 0xAAAA... 'authorizeKey(...)' ... --interactive`, signed by the owner's root key.
   - Any wallet that can send a raw call from the owner account: the printed `to` and `data`.

3. **Reset any standing approval of the pool.** If the owner account ever approved the Gloam pool (the Gloam app approves it once, for an unlimited amount), the owner sets it back to 0 with the printed `approve(pool, 0)` command. See below for why.

4. Check it. This only reads the chain:

   ```bash
   npx -y @gloamtrade/mcp authorize-access-key --check --network tempo-mainnet --owner 0xOWNER
   ```

   It reports whether the key is authorized, its expiry, what is left of each limit and when it resets, its call scopes, and any pool allowance the cap would not count. It exits 0 only when all of that is in order.

5. Restart the agent's MCP server. It logs `Signer: Tempo access key 0x... for account 0x...` and, a moment later, the same check.

To change a limit without a new key, the owner calls `updateSpendingLimit(key, token, newLimit)` on the precompile. To stop the agent, the owner revokes the key with the printed `revokeKey` command; a revoked key can never be authorized again.

### What the cap covers, and what it does not

Covers:

- Every approval the key makes for a capped stablecoin (only increases count), and so every shield the agent funds from the owner's account.
- Which contracts and functions the key may call.
- When the key stops working. A revocation applies from the moment the owner's transaction lands.

Does not cover:

- **Allowances the owner already gave.** Tempo counts `transfer`, `transferWithMemo` and `approve` made by the key, not `transferFrom`. With a standing approval of the pool, `shieldBound` can pull up to that allowance without touching the limit. Keep the owner's approval of the pool at 0; `--check` and the startup check report it.
- **Money already in the private balance.** Shielded notes are spent with the note secrets in this server's store, not with the key, so a compromised host can take what is already shielded. The cap bounds how fast money can enter the pool from the owner's account; keep the shielded balance small and the store and its key safe (see [Notes stay in the server](#notes-stay-in-the-server)).
- **Network fees.** Fees for the key's transactions come from the owner account and are not counted against the limit.
- **Robinhood Chain.** It has no keychain. In access-key mode the same key signs there as its own address, bound by the off-chain limits and whatever that address holds.

### In the server

`GLOAM_AGENT_PRIVATE_KEY` is the access key and `GLOAM_TEMPO_ACCOUNT` the owner's account. On Tempo the signer is a viem Tempo access-key account (`Account.fromSecp256k1(key, { access: owner })`): transactions are Tempo transactions from the owner's account carrying a keychain signature by the key. `GLOAM_TEMPO_FEE_TOKEN` picks the fee token. A malformed `GLOAM_TEMPO_ACCOUNT`, or one equal to the key's own address (that would be the account's root key, with no limits), stops the server at startup instead of letting it sign some other way.

## Setup

From npm, there is nothing to build: `npx -y @gloamtrade/mcp` (see [Install](#install)). From a checkout:

```bash
pnpm install                              # from the repo root
pnpm --filter @gloamtrade/mcp start       # tsx src/index.ts, no build needed
pnpm --filter @gloamtrade/mcp build       # dist/index.js, the published server
pnpm --filter @gloamtrade/mcp smoke       # start dist/index.js over stdio and list its tools
```

The Gloam workspace packages (`@gloamtrade/sdk` and others) ship TypeScript source, so the build bundles them into `dist/index.js` with esbuild and leaves every other dependency to npm. It fails if the server imports a package missing from `dependencies`. Publish with pnpm so workspace versions are rewritten: `pnpm --filter @gloamtrade/mcp publish --access public`.

To execute with a raw key instead of an access key (only the off-chain limits bind it), give the server a funded signer, a note-store key and its limits. On Robinhood Chain mainnet, for example:

```bash
GLOAM_NETWORK=robinhood-mainnet \
GLOAM_AGENT_PRIVATE_KEY=0x<key holding a little USDG and ETH for gas> \
GLOAM_NOTE_KEY=$(openssl rand -hex 32) \
GLOAM_LIMIT_ASSETS=USDG GLOAM_LIMIT_NETWORK=robinhood-mainnet \
GLOAM_LIMIT_MAX_PER_PAYMENT=5 GLOAM_LIMIT_MAX_PER_DAY=20 GLOAM_LIMIT_RECIPIENTS=any \
pnpm --filter @gloamtrade/mcp start
```

To practice with test funds instead, use `GLOAM_NETWORK=robinhood`, a key funded from the [Robinhood Chain testnet faucet](https://faucet.testnet.chain.robinhood.com/), and `GLOAM_LIMIT_ASSETS=ETH` with small caps (no `GLOAM_LIMIT_NETWORK`).

The same lines can go in `~/.gloam/agent.env`. Keep the note key somewhere durable (not a fresh `openssl` each start): the store cannot be opened without it. Without the signer the server still runs and exposes every tool; execute tools just return plans. Without limits, execute tools refuse to spend (see above). For a hard boundary use a Tempo access key (above); on other chains a policy wallet such as a Turnkey server wallet plays that role.

Tests (no chain needed): `pnpm --filter @gloamtrade/mcp test` runs the spending limits, the note custody tests (store encryption and locking, shield to pay to sweep over a mock pool, the fetch round trip, the legacy flag, and a scan that no tool result carries a secret), the access key tests (the authorization encoding and scopes, keychain signing for the owner's account, fail-closed settings, the settings file and the CLI) and the mainnet tests (which networks a build offers, mainnet assets in limits, the key set per network).

## Connect an agent

The server speaks MCP over stdio. Point any MCP client at it (Claude Desktop, Cursor, or any platform that reads MCP server configs):

```json
{
  "mcpServers": {
    "gloam": {
      "command": "npx",
      "args": ["-y", "@gloamtrade/mcp"]
    }
  }
}
```

Keys and limits come from `~/.gloam/agent.env`. For several agents on one machine, give each its own file with `"env": { "GLOAM_ENV_FILE": "/home/me/.gloam/research-bot.env" }`, or share a `GLOAM_LIMITS_FILE` and set `GLOAM_AGENT_ID` per agent. To run a checkout instead of the npm package, use `"command": "node", "args": ["/absolute/path/to/gloam/mcp/dist/index.js"]` after a build.

Then the agent can shield into a private balance, pay for x402 and MPP resources privately, and get paid, alongside its public Robinhood activity.

## Status

- **Mainnet (beta, real money):** Tempo and Robinhood Chain, payments only, beta deposit limits, the trusted setup's final keys. Reviewed internally before launch; an external audit is planned, not done.
- **Testnet (free practice):** Tempo Moderato and Robinhood Chain testnet, dev keys, test funds with no value.
- **Circuit files** are fetched from `https://www.gloam.trade/circuits` (final keys under `/final`) on first use, checked against pinned SHA-256 and cached locally (`GLOAM_ARTIFACTS_DIR`).
- **Private trading** is off on every network; the market and trade tools only plan. See the [agent docs](https://gloam.trade/docs/agents).
