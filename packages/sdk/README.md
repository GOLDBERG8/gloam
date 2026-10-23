# @gloamtrade/sdk

**Private stablecoin payments for apps and agents on Robinhood Chain and Tempo, as a package.**

Add shielded balances, private payments, and selective disclosure to any app or agent on Robinhood Chain or Tempo. Live on mainnet (beta) with the trusted setup's final keys, and on testnet for free practice. Real zero-knowledge proofs, no proving stack to build from scratch.

[![npm version](https://img.shields.io/npm/v/@gloamtrade/sdk?color=0B0C0E&label=npm)](https://www.npmjs.com/package/@gloamtrade/sdk)
[![license](https://img.shields.io/npm/l/@gloamtrade/sdk?color=0B0C0E)](https://github.com/cryptoduke01/gloam/blob/main/LICENSE)
[![types](https://img.shields.io/npm/types/@gloamtrade/sdk?color=0B0C0E)](https://www.npmjs.com/package/@gloamtrade/sdk)
[![Networks](https://img.shields.io/badge/mainnet-Robinhood%20Chain%204663%20%C2%B7%20Tempo%204217-2E7D53)](https://gloam.trade/docs/chain)

![The Gloam SDK](https://raw.githubusercontent.com/cryptoduke01/gloam/main/app/public/media/readme-hero.jpg)

---

## Table of contents

- [Why Gloam](#why-gloam)
- [What you can build](#what-you-can-build)
- [Install](#install)
- [Networks: mainnet and testnet](#networks-mainnet-and-testnet)
- [Quickstart: shield your first note](#quickstart-shield-your-first-note)
- [How it works](#how-it-works)
- [The intent model](#the-intent-model)
- [Cash out (unshield)](#cash-out-unshield)
- [Private payments (transfer)](#private-payments-transfer)
- [Selective disclosure](#selective-disclosure)
- [Private agents](#private-agents)
- [Private agent payments (x402)](#private-agent-payments-x402)
- [Take payments and read their notes](#take-payments-and-read-their-notes)
- [API reference](#api-reference)
- [Framework integration](#framework-integration)
- [Examples](#examples)
- [Pinned public inputs](#pinned-public-inputs)
- [Guardrails and honesty](#guardrails-and-honesty)
- [Links](#links)

---

## Why Gloam

Public chains are public ledgers. Every balance and every payment is visible on-chain and copyable by anyone. For a business that means payroll and suppliers are exposed. For an agent it means the entire strategy leaks on the first payment.

Gloam is the shielded layer on top of Robinhood Chain and Tempo, and `@gloamtrade/sdk` is that layer as a dependency. Deposit into a private balance, move value with the amount hidden, and prove a holding to one chosen party without revealing anything else. Every private action is backed by a real Groth16 proof verified on-chain. Nothing is a mock. If a path cannot be made private, it stays disabled rather than pretending.

The Gloam vault app is the reference implementation, not a special case. The same core that powers it is what you install here.

## What you can build

- **Shielded balances.** Deposit stablecoins (USDG on Robinhood Chain; USDC.e, pathUSD, USDT0 or OUSD on Tempo) or $GLOAM into a private balance only the holder can see or spend. On testnet you can also practice with test ETH and stock tokens.
- **Private payments.** Send inside the vault to a receive tag, with on-chain encrypted discovery through the payment-message board on every network, mainnet included. No public transfer, no visible amount.
- **Cash out.** Unshield back to a public balance with a browser- or node-generated Groth16 proof.
- **Selective disclosure.** Let a holder prove one balance to a chosen party, an auditor or a counterparty, revealing nothing else. Provable, not a dark pool.
- **Private agents.** The same core runs server-side, so an autonomous agent can hold and move value under policy with its size and strategy hidden.
- **Private agent payments (x402).** Agents pay for tools and data over HTTP 402 and settle privately, so the amount, sender, and recipient never go public.

## Install

```bash
npm install @gloamtrade/sdk viem
npm install snarkjs   # optional peer, needed only when you generate proofs
```

`viem` handles signing and RPC. `snarkjs` is a lazy peer, imported dynamically only inside the prover, so it is required only for paths that generate a proof (shield, unshield, transfer, disclosure).

Prefer to start from a working app instead of wiring it yourself:

```bash
npm create gloam-app@latest my-private-app
```

That scaffolds a Next.js app already wired to the SDK. See [create-gloam-app](https://www.npmjs.com/package/create-gloam-app).

## Networks: mainnet and testnet

Gloam runs on two chains, each with a mainnet (real money) and a testnet (free practice). They are separate pools of the same design, not a bridge.

| Network | Key | Chain id | Pool | Assets (beta limit per deposit / total) | Keys |
| --- | --- | --- | --- | --- | --- |
| Robinhood Chain | `robinhood-mainnet` | `4663` | `0x39e28cde55cab798874746ac52cb4b5cc99a0194` (block `94194599`) | USDG (500 / 25,000), $GLOAM (25,000 / 250,000) | Final |
| Tempo | `tempo-mainnet` | `4217` | `0x39e28cde55cab798874746ac52cb4b5cc99a0194` (block `45172561`) | USDC.e, pathUSD, USDT0, OUSD (500 / 25,000 each) | Final |
| Robinhood Chain testnet | `robinhood` | `46630` | `0x72406D9597807A46f730d8b4fDBC5aC45Dc1d740` | Test ETH, test USDG, stock tokens | Dev |
| Tempo testnet (Moderato) | `tempo` | `42431` | `0x841DC046Ea3CC842BA3A855731472c6Eb0F2d5eb` | PathUSD and other test stablecoins | Dev |

```ts
import { mainnetNetwork, gloamNetworks, getGloamNetwork, GLOAM_NETWORKS } from "@gloamtrade/sdk";

const tempo = mainnetNetwork("tempo");        // Tempo mainnet, or null if this SDK version has no pool for it
const all = gloamNetworks();                  // mainnets first, then the testnets
const rh = getGloamNetwork("robinhood-mainnet");
const practice = GLOAM_NETWORKS.tempo;        // the testnets, unchanged since 0.0.x
```

Each `GloamNetwork` carries `chainId`, `pool`, `deployBlock`, a viem `chain`, `rpcUrl`, `explorerUrl`, `assets` (with `depositLimit`), `testnet`, and `ceremony`.

What is different on mainnet:

- **Final keys.** The mainnet verifiers hold the final keys of the 13-contributor trusted setup (drand round 6561386, release `ceremony-final`). The testnets keep the single-party dev keys. A proof made with one set never verifies against the other, so prove with `circuitArtifactUrls(circuit, chainId)`, which picks the right set for the chain.
- **Payments only.** The mainnet pools (`ShieldPoolPayments`) take deposits, private payments and cash outs, and have no swap code. Private swaps run in the Gloam app through a separate router on each mainnet; this SDK does not build them yet. Stock tokens are testnet only, and Robinhood Chain mainnet takes no native ETH deposit (ETH is only gas).
- **Beta deposit limits.** 500 per deposit and 25,000 in total for each stablecoin, 25,000 and 250,000 for $GLOAM. `buildShieldBoundIntent` refuses an unlisted asset or an amount over the per-deposit limit before it proves. Cash outs and private payments are never limited.
- **Fees.** Deposits and private payments are free. A cash out costs 0.25%: the pool keeps `cashOutFee(amount)` and sends the rest.
- **Pools come with the SDK version.** Mainnet pool addresses live in `MAINNET_POOLS`. If your SDK version has no pool for a mainnet, `mainnetNetwork()` returns `null` and the builders refuse that chain id rather than guess. Update the SDK, or pass `poolAddress` yourself.

The builders still default to Robinhood Chain testnet when you pass no `chainId`, so code written for 0.0.x keeps working. For mainnet, pass the network explicitly, as below.

## Quickstart: shield your first note

The pool enforces a proof at deposit, so `buildShieldBoundIntent` mints the note **and** generates the shield proof. You approve the token and sign the resolved call. The `note.secret` it returns is the only spend authority, so persist it.

```ts
import {
  mainnetNetwork,
  buildShieldBoundIntent,
  artifactProver,
  circuitArtifactUrls,
  TEMPO_USDCE,
} from "@gloamtrade/sdk";
import { createWalletClient, createPublicClient, http, erc20Abi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const net = mainnetNetwork("tempo");          // Tempo mainnet: real money
if (!net) throw new Error("This SDK version has no Tempo mainnet pool yet.");

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: net.chain, transport: http(net.rpcUrl) });
const publicClient = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });
const amount = parseUnits("25", 6);           // 25 USDC.e; the beta limit is 500 per deposit

// 1. Mint the note and generate the shield proof with the mainnet (final) keys.
const intent = await buildShieldBoundIntent({
  chainId: net.chainId,
  poolAddress: net.pool,
  asset: TEMPO_USDCE,
  amountWei: amount,
  prover: artifactProver(circuitArtifactUrls("shield", net.chainId)),
});

// 2. Let the pool pull the token, then sign the resolved shieldBound(asset, amount, commitment, proof) call.
await publicClient.waitForTransactionReceipt({
  hash: await wallet.writeContract({ address: TEMPO_USDCE, abi: erc20Abi, functionName: "approve", args: [net.pool, amount] }),
});
const hash = await wallet.writeContract({
  address: intent.exec.poolAddress,
  abi: shieldBoundAbi,
  functionName: intent.exec.fn,   // "shieldBound"
  args: intent.exec.args,
  value: intent.exec.valueWei,    // 0n for tokens
});

// 3. PERSIST THIS. Losing note.secret loses the funds.
saveSecret(intent.note.commitment, intent.note.secret);
```

On Robinhood Chain mainnet use `mainnetNetwork("robinhood")` with `RH_MAINNET_USDG` (or `GLOAM_TOKEN`). Gas is ETH on Robinhood Chain and a USD stablecoin on Tempo.

To practice for free first, use a testnet: `GLOAM_NETWORKS.tempo` (test PathUSD from the Tempo faucet) or `GLOAM_NETWORKS.robinhood` (test ETH and test USDG). The same code works with that network's `chainId`, `pool` and assets, and `circuitArtifactUrls` picks the dev keys.

The minimal ABI fragment for the one call you make:

```ts
const shieldBoundAbi = [{
  type: "function", name: "shieldBound", stateMutability: "payable",
  inputs: [
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "commitment", type: "bytes32" },
    { name: "proof", type: "bytes" },
  ],
  outputs: [],
}] as const;
```

Circuit files are served at [www.gloam.trade/circuits](https://www.gloam.trade/circuits): the dev keys at the root, the final keys under `/circuits/final`. `circuitArtifactUrls` returns the right URLs; in the browser pass them straight to `artifactProver`. In node, snarkjs proves from local files, so download them first and check them against `CIRCUIT_SHA256`. The full walkthrough, including confirming the deposit and cashing out, is in the [quickstart](https://gloam.trade/docs/quickstart).

## How it works

A private balance is a **note**:

```
commitment = Poseidon(secret, amount, asset)
nullifier  = Poseidon(secret, commitment)
```

Shielding inserts the `commitment` as a leaf in a depth-20 incremental Merkle tree. The `secret` is the only spend authority and never leaves the client. Spending (send, cash out, trade) proves in zero knowledge that you know the secret for a commitment in the tree, and publishes the `nullifier` so it cannot be spent twice, all without revealing which note. The chain verifies a Groth16 proof, never your identity or size.

The note commitment binds the asset, so one pool holds several assets (stablecoins, $GLOAM, and on testnet ETH and stock tokens) without mixing them up.

## The intent model

Every action is an **intent** with two layers. The **plan** is portable and safe to log or hand to an agent (symbol, amount, no secrets). The **exec** resolves the on-chain call (wei amounts, resolved addresses, proof args). The SDK and the agent server share one intent shape, so a plan an app builds and a plan an agent builds are the same object.

```ts
interface GloamIntent<K> {
  intent: K;                  // "shield" | "unshield" | "private_send" | "private_trade"
  chainId: number;
  agentAddress: Address | null;
  plan: PlanFor<K>;           // portable: symbol, amount, no secrets
  privacy: string;            // plain-language: what is and is not hidden
  execution: string;          // plain-language: how to sign and broadcast
  exec: IntentExec;           // the resolved on-chain call
}

interface IntentExec {
  poolAddress: Address;
  fn: PoolFn;                 // e.g. "shieldBound", "unshield", "transfer"
  valueWei: bigint;           // ETH to attach (native shield only)
  args: readonly unknown[];   // ABI-ordered call args
}
```

You always sign and broadcast yourself. The SDK never holds a key.

## Cash out (unshield)

A spend needs a membership path, which needs the current tree. `syncTree` rebuilds it from chain (replaying `Shielded`, `Transferred`, and `SealedSwapped` leaves in order, so the root stays correct after any transfer). Then `buildUnshieldIntent` builds the witness and the proof. On exit, the amount, asset, and recipient become public. The source note stays unlinkable via the nullifier.

On mainnet the pool keeps a 0.25% cash-out fee: cashing out `amount` sends `amount - cashOutFee(amount)` to `to`. The note is spent in full either way.

```ts
import { buildUnshieldIntent, artifactProver, circuitArtifactUrls, syncTree, cashOutFee } from "@gloamtrade/sdk";

const synced = await syncTree(publicClient, { pool: net.pool, fromBlock: net.deployBlock });
const path = await synced.pathForCommitment(note.commitment);
if (!path) throw new Error("note not found in the tree yet");

const exit = await buildUnshieldIntent({
  chainId: net.chainId,
  poolAddress: net.pool,
  secretHex: note.secret,
  amountWei: note.amountWei,      // the whole note
  asset: note.asset,
  to: account.address,
  path,
  prove: artifactProver(circuitArtifactUrls("unshield", net.chainId)),
});
// `to` receives note.amountWei - cashOutFee(note.amountWei) on mainnet.

await wallet.writeContract({
  address: exit.exec.poolAddress,
  abi: unshieldAbi,
  functionName: exit.exec.fn,     // "unshield"
  args: exit.exec.args,
});
```

## Private payments (transfer)

`buildPrivateSendIntent` spends a note and produces two new notes: a payment note for the recipient and a change note for the sender. There is no public transfer and no visible amount.

```ts
import { buildPrivateSendIntent, artifactProver, circuitArtifactUrls, syncTree } from "@gloamtrade/sdk";

const synced = await syncTree(publicClient, { pool: net.pool, fromBlock: net.deployBlock });
const path = await synced.pathForCommitment(note.commitment);

const send = await buildPrivateSendIntent({
  chainId: net.chainId,
  poolAddress: net.pool,
  secretHex: note.secret,
  amountInWei: note.amountWei,       // the source note's amount
  amountPayWei: parseUnits("10", 6), // amount to send; the rest is your change
  asset: note.asset,
  path,
  prove: artifactProver(circuitArtifactUrls("transfer", net.chainId)),
});

await wallet.writeContract({
  address: send.exec.poolAddress,
  abi: transferAbi,
  functionName: send.exec.fn,       // "transfer"
  args: send.exec.args,
});

// Hand send.paymentNote to the recipient; keep send.changeNote.
```

Private payments are free and have no limit. The testnets also have an on-chain encrypted memo board (`GloamPayMemo`) so a recipient can find a payment with their Gloam address; the mainnet pools have none at launch, so hand the payment note over directly or seal it to the payee's receive tag.

## Selective disclosure

Private by default, provable by choice. A holder proves one shielded balance to a party they choose, revealing nothing about their identity, their other notes, or the note secret (so the disclosure can never move the funds). It reuses the shield circuit, so there is no extra setup, and it verifies in-browser with no wallet. See the [disclosure guide](https://gloam.trade/docs/sdk/disclosure).

## Private agents

The crypto core is pure and isomorphic, so the exact code above runs server-side. An AI agent can shield, pay, and prove holdings with its size and strategy hidden. Two ways in:

- **Directly via `@gloamtrade/sdk`.** Your agent framework builds an intent and signs it with its own wallet.
- **Via the `@gloamtrade/mcp` server** (`npx -y @gloamtrade/mcp`). An MCP-speaking model gets Gloam as tools alongside its other capabilities, with planning and execution kept separate, keys held server-side, and spending limits the agent cannot lift.

See [Build a private agent](https://gloam.trade/docs/agents).

## Private agent payments (x402)

Agents pay for tools and data over HTTP 402. The pattern that won Colosseum (MCPay) paired x402 with stablecoins, but that settlement is fully public: the amount, the payer, and the payee all leak. Gloam's `gloam-private` scheme keeps the settlement private and self-custodial. The agent settles a shielded transfer to the payee itself (no operator or facilitator ever holds its key or funds), then presents the payment note plus the settlement tx on the 402 retry.

Two rules keep the money safe:

- **The payment note is sealed to the payee.** `payTo` must be the payee's receive tag (`gloamr1.…`). `buildGloamPayment` encrypts the payment note to it, so the agent, a proxy or a log that sees the `X-PAYMENT` header cannot open it. A `payTo` that is not a receive tag is refused.
- **The payee sweeps before it serves.** The payer created the payment note, so it knows the secret too and could spend it back after being served. `settleGloamPayment` opens the note, verifies it, and moves it into a fresh note only the payee knows. Grant access only when it returns `grantAccess: true`. A `verifyGloamPayment` on its own always says `final: false`.

```ts
import {
  generateReceiveKey,
  buildGloamPaymentRequirements,
  buildGloamPayment,
  settleGloamPayment,
  decodePaymentHeader,
  sweepChainFromClient,
  relaySubmitter,
  transferCallArgs,
  POOL_TRANSFER_ABI,
  artifactProver,
} from "@gloamtrade/sdk";

// Server, once: a receive key. Share the tag; keep privateJwk secret, server-side.
const seller = await generateReceiveKey();

// Server: price a resource. This is the 402 challenge.
const requirements = buildGloamPaymentRequirements({
  amountWei: parseUnits("0.25", 6),
  asset: TEMPO_USDCE,        // a stable asset the pool lists
  assetSymbol: "USDC.e",
  network: net.chainId,      // the pool is resolved from the network (pass poolAddress to override)
  payTo: seller.tag,         // the payment is sealed to this
  resource: "mcp://tool/summarize",
});

// Agent: build the private payment, broadcast it, then present the header.
const pay = await buildGloamPayment({
  requirements,
  senderSecretHex: note.secret,
  senderNoteAmountWei: note.amountWei,
  path,                                  // from syncTree.pathForCommitment
  prove: artifactProver(circuitArtifactUrls("transfer", net.chainId)),
  issuerTag: "issuer:usd",               // optional issuer-scoped compliance disclosure
});
const hash = await wallet.writeContract({
  address: pay.intent.exec.poolAddress, abi: POOL_TRANSFER_ABI, functionName: "transfer", args: transferCallArgs(pay.intent),
}); // agent self-settles
pay.payload.payload.txHash = hash;
// Keep pay.changeNote (the agent's remaining balance). pay.paymentNote never needs to leave this process.

// Server: open, verify and sweep. Serve only when grantAccess is true.
const result = await settleGloamPayment({
  requirements,
  payload: decodePaymentHeader(xPaymentHeader),
  receiveKey: seller,
  prove: artifactProver(circuitArtifactUrls("transfer", net.chainId)),
  chain: sweepChainFromClient(publicClient, { pool: net.pool, fromBlock: net.deployBlock }),
  submit: relaySubmitter(),                                  // or your own wallet
  beforeSubmit: (fresh) => saveNote(fresh),                  // persist before it is sent
});
if (result.grantAccess) serve(); // result.freshNote is the payment, in a note only you know
// Otherwise result.status says why: already_spent (the payer took it back first),
// not_settled (not in the pool yet), rejected, failed or unconfirmed.
```

The sealed ticket is the same format the Gloam app uses for paying a receive tag (`gloam2t.…`, ECDH P-256 + HKDF-SHA256 + AES-256-GCM over a `gloam1.` note package), so a payment sealed by an agent opens in the app, and a tag made in the app works as `payTo`.

**Upgrading from 0.0.5.** `payTo` must now be a receive tag, in `buildGloamPaymentRequirements` and `buildGloamPayment` (pass `legacyUnsealed: true` to pay an old server anyway; the note then travels in plain text, readable by anyone who sees the header). A sealed payment must be opened before `verifyGloamPayment` can read it (`openGloamPaymentNote`, then pass `note`); `settleGloamPayment` does all of this and the sweep.

**This is not a Tempo Zone.** A Zone is operator-visible: the zone operator sees every transaction inside it. Gloam is private from the public and from any operator; only the payer and the payee learn the amount. Compliance visibility is opt-in per payment via `buildComplianceDisclosure`, an issuer-scoped disclosure that reuses the shield-circuit proof rather than handing an operator a blanket view. See [`TEMPO_EXPANSION.md`](https://github.com/cryptoduke01/gloam/blob/main/TEMPO_EXPANSION.md).

## Take payments and read their notes

New in 0.2.0. A service can ask to be paid privately, with a note on each payment (an invoice number, an agent ID), and credit each payment by its note. Only your key reads the note, and nothing on chain ties the payer to it.

1. **Hold a receive key.** `generateReceiveKey()` gives you a Gloam address (`gloamr1.…`) to share and a private key to keep on your server.
2. **Make a request link** with `buildPaymentRequestLink`: the same link the Gloam app makes, with your address, the network, the token, an optional amount and a note of up to 80 characters. A longer note is refused, not cut.
3. **The payer pays it** from their private balance in Gloam. The note travels inside the payment, sealed to your address.
4. **Find it.** Where the network has a payment-message board, `scanIncomingPayments` returns every payment sealed to your key, with its amount, token and note. It only returns payments that are in the vault and not yet spent, read at one block, and it splits any block range the node refuses. Resume from `scannedTo + 1`.
5. **Secure it, then credit.** Until you move it, the payer could still spend it back. `sweepReceivedNote` moves it into a note only you know, through the Gloam relay, so your server needs no gas. Credit only when it returns `final: true`.

```ts
import {
  mainnetNetwork, generateReceiveKey, buildPaymentRequestLink,
  scanIncomingPayments, openIncomingPayment, notePackageToExport,
  sweepReceivedNote, sweepChainFromClient, relaySubmitter, findRequestAsset,
} from "@gloamtrade/sdk";

const net = mainnetNetwork("robinhood")!;
const key = await generateReceiveKey();       // keep key.privateJwk secret
const usdg = findRequestAsset(net, "USDG")!;  // the token you credit

const link = buildPaymentRequestLink({
  payTo: key.tag, network: net, asset: "USDG", amount: "25", note: "agent:42",
});

// With a payment-message board: scan for payments to your key.
const { payments, scannedTo } = await scanIncomingPayments({ client, network: net, receiveKey: key });

// Or check a sealed code a payer hands over directly.
const check = await openIncomingPayment({ client, network: net, receiveKey: key, sealedTicket: code });

for (const p of payments) {
  const r = await sweepReceivedNote({
    note: await notePackageToExport(p.notePackage),
    poolAddress: net.pool, chainId: net.chainId, prove,
    chain: sweepChainFromClient(client, { pool: net.pool, fromBlock: net.deployBlock }),
    submit: relaySubmitter(),
    beforeSubmit: (fresh) => saveNote(fresh),  // persist before it is sent
  });
  // Anyone can pay in any token the vault takes: credit only the one you priced in.
  if (r.final && p.asset.toLowerCase() === usdg.address.toLowerCase()) creditAgent(p.note, p.amountWei);
}
```

**Every network has a board,** Robinhood Chain and Tempo mainnet included (since October 2026), so `scanIncomingPayments` finds payments to your key on its own. A payer can also hand you the sealed code (`gloam2t.…`) their app shows after paying; check it with `openIncomingPayment`, which says whether it is ready, has not landed yet, or was already spent. The full runnable version is [`examples/receive-and-credit.ts`](https://github.com/cryptoduke01/gloam/tree/main/packages/sdk/examples/receive-and-credit.ts).

## API reference

Everything exports from one barrel. The crypto and math core is pure and runs anywhere. Proving (snarkjs plus artifacts) and storage (notes, keys) are injected, so the same core serves a browser app and a node signer.

### Networks, keys and fees (new in 0.1.0)

```ts
mainnetNetwork("robinhood" | "tempo"): GloamNetwork | null  // null until this SDK version has the pool
gloamNetworks(): GloamNetwork[]                             // mainnets with a pool first, then testnets
getGloamNetwork(key): GloamNetwork | null                   // "robinhood-mainnet" | "tempo-mainnet" | "robinhood" | "tempo"
networkForChainId(chainId): GloamNetwork | undefined        // now finds mainnets too
GLOAM_NETWORKS / GLOAM_TESTNETS                             // the two testnets, unchanged
poolForChainId(chainId): Address                            // throws rather than guess
isMainnetChainId(chainId), networkName(chainId)
ceremonyForChainId(chainId): "dev" | "production"           // production (final keys) on 4663 and 4217
circuitArtifactUrls(circuit, chainId, base?)                // { wasm, zkey } for "shield" | "transfer" | "unshield"
circuitArtifactFiles(circuit, ceremony), CIRCUIT_SHA256     // relative paths and SHA-256 to check a download
GLOAM_ARTIFACTS_URL                                         // https://www.gloam.trade/circuits
assertDepositAllowed(chainId, asset, amount)                // listed asset, beta per-deposit limit, no native on mainnet
CASH_OUT_FEE_BPS, cashOutFee(amount, bps?)                  // 25 bps on mainnet, rounded down like the pool
MAINNET_POOLS, mainnetPoolFor(chainId)                      // the one place mainnet pool addresses live
RH_MAINNET_CHAIN, TEMPO_MAINNET_CHAIN, RH_TESTNET_CHAIN, TEMPO_TESTNET_CHAIN  // viem chains
RH_MAINNET_ASSETS, TEMPO_MAINNET_ASSETS                     // assets with beta deposit limits
RH_MAINNET_USDG, GLOAM_TOKEN, TEMPO_USDCE, TEMPO_USDT0, TEMPO_PATHUSD, TEMPO_OUSD
RH_MAINNET_CHAIN_ID (4663), TEMPO_MAINNET_CHAIN_ID (4217), MAINNET_POSEIDON_T3
```

### Intent builders

| Function | Resolves | Status |
| --- | --- | --- |
| `buildShieldBoundIntent(p)` | Mints a note + shield proof, then `shieldBound(...)` | Live, mainnet and testnet |
| `buildShieldIntent(p)` | Plain `shield(...)`, no proof (legacy pools only) | Refused on mainnet |
| `buildUnshieldIntent(p)` | Witness + proof, then `unshield(...)` (cash out) | Live, mainnet and testnet |
| `buildPrivateSendIntent(p)` | Transfer witness, then `transfer(...)`; returns payment + change notes | Live, mainnet and testnet |
| `buildPrivateTradeIntent(p)` | Sealed-swap witness, then `sealedSwap(...)` | Retired; refused on mainnet |

Each builder returns a `GloamIntent` whose `exec` is guaranteed populated. Every builder takes `chainId` (default Robinhood Chain testnet) and `poolAddress` (default: Gloam's pool on that chain). `buildPrivateTradeIntent` produces a valid intent for the testnets, but the sealed trade is retired and switched off on every live pool, so its call reverts.

### Notes

```ts
makeBoundNotePoseidon(amount: bigint, asset?: Address): Promise<BoundNote>
noteCommitmentPoseidon(secret: bigint, amount: bigint, asset?: Address): Promise<bigint>
noteNullifierPoseidon(secret: bigint, commitment: bigint): Promise<bigint>
openNotePoseidon(secretHex: Hex, amount: bigint, asset: Address)
randomSecretField(): Promise<bigint>
```

### Prover (injected)

```ts
type Prover = (input: Record<string, string | string[]>) => Promise<ProveResult>
artifactProver(a: { wasm: string; zkey: string }): Prover   // paths in node, URLs in the browser
proveGroth16(input, wasm, zkey)                              // one-shot form
```

### Tree sync

```ts
syncTree(client, { pool, fromBlock?, chunkSize? }): Promise<SyncedTree>
assertTreeMatchesChain(client, pool, synced): Promise<boolean>
// SyncedTree.pathForCommitment(commitment) feeds straight into the spend builders.
```

### x402 payments

```ts
buildGloamPaymentRequirements(p): GloamPaymentRequirements   // server: the 402 challenge (payTo must be a receive tag)
buildGloamPayment(p): Promise<BuiltPayment>                  // agent: private send + X-PAYMENT header, note sealed to payTo
settleGloamPayment(p): Promise<SettleResult>                 // server: open + verify + sweep; grant access on grantAccess
openGloamPaymentNote(paymentNote, receiveKey?)               // server: open the sealed payment note
verifyGloamPayment({ requirements, payload, note? }): VerifyResult  // structural verify, always final: false
verifyPaymentNoteBinding(note): Promise<boolean>             // crypto: amount binds to commitment
buildComplianceDisclosure(p): Promise<GloamComplianceDisclosure>  // optional issuer-scoped disclosure
encodeRequirements / decodeRequirements                      // 402 body transport
encodePaymentHeader / decodePaymentHeader                    // X-PAYMENT transport
GLOAM_VS_ZONE, GLOAM_X402_SCHEME, GLOAM_NOT_FINAL            // posture, scheme id, the not-final notice
```

`buildGloamPayment` does not broadcast: the agent signs and broadcasts the returned `intent.exec` itself, staying self-custodial, then sets `payload.txHash`. `verifyGloamPayment` confirms the payment note binds the required amount and asset, is the payment output of the transfer, and settles through the right pool. It never makes a payment final: its result carries `final: false` and a plain `finality` notice. `settleGloamPayment` runs it, checks the binding, and sweeps.

### Receive tags and sweeps

```ts
generateReceiveKey(): Promise<ReceiveKey>                    // { tag: "gloamr1.…", privateJwk }
isReceiveTag(s) / assertReceiveTag(s)                        // strict: gloamr1. + a P-256 public key
sealToReceiveTag(text, tag) / openSealedTicket(sealed, key)  // gloam2t.… tickets, app-compatible
encodeNotePackage / decodeNotePackage                        // gloam1.… note packages, app-compatible
sweepReceivedNote(p): Promise<SweepResult>                   // move a received note into a fresh one
sweepChainFromClient(publicClient, { pool, fromBlock })      // the chain reads a sweep needs
relaySubmitter(opts?)                                        // submit sweeps through the Gloam relay
POOL_TRANSFER_ABI, POOL_STATE_ABI, transferCallArgs(intent)  // sign a transfer with your own wallet
```

A sweep spends the received note into a fresh note of the whole amount plus a zero-value change note, both with secrets only the payee knows. It checks the nullifier first (`already_spent` if the payer got there), stores nothing itself (persist the fresh note in `beforeSubmit`), and reports `final: true` only once the sweep confirms or its fresh note is seen on chain.

### Request links and incoming payments (new in 0.2.0)

```ts
buildPaymentRequestLink({ payTo, network, asset, amount?, note?, name?, origin? }): string  // the app's exact link
parsePaymentRequestLink(link)                                 // read the fields back
normalizeRequestAmount(input, asset), findRequestAsset(net, s), REQUEST_NOTE_MAX (80)
scanIncomingPayments({ client, network, receiveKey, fromBlock?, toBlock?, board? })
  : Promise<{ payments: IncomingPayment[]; scannedTo: bigint }>  // where the network has a board
openIncomingPayment({ client, network, receiveKey, sealedTicket })
  : Promise<{ status: "ready" | "not_in_vault_yet" | "already_spent"; payment }>  // a code handed over
payMemoBoardFor(chainId), PAY_MEMO_BOARDS, NoPayMemoBoardError
cleanPaymentNote(s), PAYMENT_NOTE_MAX                         // the app's note rules
```

`IncomingPayment` carries `commitment`, `nullifier`, `amountWei`, `asset`, `note`, the `sealedTicket`, the opened `notePackage` (pass `notePackageToExport(notePackage)` to `sweepReceivedNote`), and where it was posted. Note packages now carry the payer's note under `n`, byte for byte like the app.

### Merkle, rates, privacy, constants

```ts
IncrementalMerkleTreePoseidon, pathToCircomInput, MERKLE_DEPTH
exactSealedAmounts, estimateSealedOut, marksToSealedRates   // sealed-rate math (pure)
publicAmountOutMin, SEALED_PRIVACY_FACTS                    // size-privacy policy
SEALED_VAULT, TEMPO_SEALED_VAULT, SHIELD_VERIFIER, NATIVE_ASSET   // testnet pools and the native-asset sentinel
RH_TESTNET_CHAIN_ID, TEMPO_TESTNET_CHAIN_ID, RH_MAINNET_CHAIN_ID, TEMPO_MAINNET_CHAIN_ID
```

The full surface, with every parameter interface, is documented at [gloam.trade/docs/sdk/reference](https://gloam.trade/docs/sdk/reference).

![The Gloam docs](https://raw.githubusercontent.com/cryptoduke01/gloam/main/app/public/media/readme-docs.jpg)

## Framework integration

The SDK ships TypeScript source and is consumed through your bundler. It uses NodeNext `.js` import specifiers internally.

**Next.js** (App Router). Transpile the package and map the `.js` specifiers to `.ts`:

```js
// next.config.mjs
const nextConfig = {
  transpilePackages: ["@gloamtrade/sdk"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};
export default nextConfig;
```

**Vite / tsx / node.** Works out of the box with a bundler or a TypeScript-aware runner. `snarkjs` and `circomlibjs` have no bundled types, so if your `tsconfig` is strict, add ambient shims (`declare module "snarkjs"` and `declare module "circomlibjs"`); the [web example](https://github.com/cryptoduke01/gloam/tree/main/examples/web-shield) includes a copy you can drop in.

## Examples

Runnable references, one for each shape a builder starts from:

| Example | Runtime | What it shows |
| --- | --- | --- |
| [agent-shield](https://github.com/cryptoduke01/gloam/tree/main/examples/agent-shield) | Node | The smallest agent: mint a note, prove, deposit privately. |
| [pay-bot](https://github.com/cryptoduke01/gloam/tree/main/examples/pay-bot) | Node | A private payment end to end: shield, sync, send. |
| [pay-x402](https://github.com/cryptoduke01/gloam/tree/main/examples/pay-x402) | Node | A private agent payment over x402: price, pay sealed to the payee, sweep, serve. |
| [web-shield](https://github.com/cryptoduke01/gloam/tree/main/examples/web-shield) | Browser | Shield in the browser, read the balance back from chain. |
| [receive-and-credit](https://github.com/cryptoduke01/gloam/tree/main/packages/sdk/examples/receive-and-credit.ts) | Node | Take payments by request link, read each payment's note, secure it, credit the account it names. |

![Add money privately in the browser](https://raw.githubusercontent.com/cryptoduke01/gloam/main/app/public/media/readme-browser.jpg)

## Pinned public inputs

`PUBLIC_INPUTS` pins the exact signal ordering the deployed verifiers expect, so an integrator cannot drift out of proof compatibility:

```ts
PUBLIC_INPUTS.unshield   // [root, nullifier, asset, amount, to]
PUBLIC_INPUTS.transfer   // [root, nullifier, newCommitment0, newCommitment1]
PUBLIC_INPUTS.sealedSwap // [root, nullifier, newCOut, newCChange, assetIn, assetOut, amountOutMin, rateIn, rateOut]
```

## Guardrails and honesty

- **Mainnet is beta, with real money.** Robinhood Chain (`4663`) and Tempo (`4217`) run on the final keys of the 13-contributor trusted setup, with beta deposit limits. The contracts and circuits had an internal pre-mainnet review on 20 October 2026 with no Critical or High findings open; an external audit is planned and not done yet. Start small.
- **A new pool has a small crowd.** Privacy depends on how many notes you hide among. On a brand new mainnet pool that crowd is thin at first, so do not treat a quick deposit and cash out of the same amount as unlinkable.
- **Testnet is free practice.** Robinhood Chain testnet (`46630`) and Tempo Moderato (`42431`) keep running with the single-party dev keys and test funds that have no value.
- **Real privacy only.** No mock successes. If a path cannot be private, the SDK returns a plan rather than a fake result.
- **The sealed trade is retired** on every pool (the mainnet pools have no swap code at all). Private swaps are live in the Gloam app on both mainnets; the SDK does not build them yet. Shield, private send, cash out, and disclosure are live and proof-gated.
- **Note secrets are the sole spend authority.** Persist and protect them. `localStorage` is fine for a demo, not for real value. Never hand one to an agent: the `@gloamtrade/mcp` server keeps them in an encrypted store and gives the agent handles.
- **A received x402 payment is not yours until you sweep it.** The payer knows the payment note's secret. Use `settleGloamPayment` and serve only on `grantAccess`.

## Links

- Documentation: [gloam.trade/docs/sdk](https://gloam.trade/docs/sdk)
- Quickstart: [gloam.trade/docs/quickstart](https://gloam.trade/docs/quickstart)
- API reference: [gloam.trade/docs/sdk/reference](https://gloam.trade/docs/sdk/reference)
- App: [gloam.trade](https://gloam.trade)
- Source: [github.com/cryptoduke01/gloam](https://github.com/cryptoduke01/gloam)
- X: [@gloamtrade](https://x.com/gloamtrade)
- Email: [hello@gloam.trade](mailto:hello@gloam.trade)

## License

MIT
