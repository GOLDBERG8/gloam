/**
 * @gloamtrade/sdk — Gloam's private path as a reusable package.
 *
 * Shielded balances, private transfers, and private payments that any app or
 * agent can plug into. It runs on both chains Gloam deploys to, Robinhood Chain
 * and Tempo, on mainnet (real money, the ceremony's final keys) and on testnet
 * (test funds, dev keys). Each is a separate deployment of the same
 * shielded-pool design: pick a network (mainnetNetwork("tempo"),
 * gloamNetworks(), or GLOAM_NETWORKS for the testnets), pass its `chainId` and
 * `poolAddress`, and prove with circuitArtifactUrls(circuit, chainId). The
 * Gloam vault app is the reference implementation.
 *
 * Surface (all live and exported below):
 *
 *   note      note commitment + nullifier (Poseidon), field math
 *   merkle    depth-20 incremental Merkle tree + circom path builder
 *   sync      rebuild the pool tree from chain -> membership paths for spends
 *   witness   unshield / transfer / sealedSwap witness builders
 *   proofs    proof-of-funds + proof-of-payment witnesses, verifier context
 *   prove     injected Groth16 prover (artifactProver) + proof packing
 *   rates     sealed-rate math + size-privacy policy (pure)
 *   builders  shieldBound | unshield | privateSend | privateTrade intents
 *   x402      private agent payments over HTTP 402 (settle-then-prove)
 *   receive   receive tags: seal a payment so only its payee can open it
 *   sweep     payee side: move a received payment to a fresh note (final)
 *   requests  payment request links (pay my Gloam address, with a private note)
 *   incoming  payee side: find payments sealed to your key and read their notes
 *   api       GloamApiClient: the partner API (relay with a key, proofs, links)
 *   constants pool + verifier addresses, chain ids, networks (mainnet and
 *             testnet), assets + beta limits, cash-out fee, circuit files
 *   mainnet   MAINNET_POOLS, the one place mainnet pool addresses live
 *
 * Environment split: the crypto/math core is pure and runs anywhere. Proving
 * (snarkjs + artifacts) and storage (notes, keys) are injected, so the same core
 * serves the browser app and the node MCP signer. sealedSwap builds a valid
 * intent, but private trading is switched off on every live pool (the mainnet
 * pools have no swap at all), so its on-chain path reverts today.
 */

export const SDK_VERSION = "0.2.0";

export * from "./intents.js";
export * from "./rates.js";
export * from "./privacy.js";
export * from "./constants.js";
export * from "./mainnet.js";
export * from "./poseidon.js";
export * from "./note.js";
export * from "./merkle.js";
export * from "./proof.js";
export * from "./witness.js";
export * from "./proofs.js";
export * from "./prove.js";
export * from "./builders.js";
export * from "./sync.js";
export * from "./x402.js";
export * from "./receiveTag.js";
export * from "./sweep.js";
export * from "./requests.js";
export * from "./incoming.js";
export { PAYMENT_NOTE_MAX, cleanPaymentNote } from "./paymentNote.js";
export * from "./relay.js";
export * from "./api.js";
