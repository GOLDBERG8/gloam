/**
 * Take payments privately, and credit each one by its note.
 *
 * The flow, for a service that tops up accounts or agents:
 *   1. Your server holds a Gloam receive key. Its address (gloamr1.…) is public;
 *      the key never leaves the server.
 *   2. For each agent, you make a payment request link whose note is the
 *      agent's ID.
 *   3. A user opens the link in Gloam and pays from their private balance. The
 *      agent ID travels inside the payment, sealed so only your key reads it.
 *      Nothing on chain ties the payer to the agent.
 *   4. Your server finds the payment, secures it into a note only you know, and
 *      then credits the agent named in the note.
 *
 * Run it:
 *   npm install @gloamtrade/sdk viem snarkjs
 *   npx tsx receive-and-credit.ts
 *
 * Robinhood Chain and Tempo mainnet both have a payment-message board, so
 * watch() finds payments to your Gloam address on its own. handleCode() is the
 * fallback for a sealed code (gloam2t.…) a payer hands over directly.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createPublicClient, formatUnits, http } from "viem";
import {
  artifactProver,
  buildPaymentRequestLink,
  circuitArtifactFiles,
  ceremonyForChainId,
  generateReceiveKey,
  GLOAM_ARTIFACTS_URL,
  mainnetNetwork,
  notePackageToExport,
  openIncomingPayment,
  payMemoBoardFor,
  relaySubmitter,
  scanIncomingPayments,
  sweepChainFromClient,
  sweepReceivedNote,
  type IncomingPayment,
  type NoteExport,
  type ReceiveKey,
} from "@gloamtrade/sdk";

const network = mainnetNetwork("robinhood")!; // or mainnetNetwork("tempo")
const client = createPublicClient({ chain: network.chain, transport: http(network.rpcUrl) });

// ── 1. Your receive key ─────────────────────────────────────────────────────────
// Make it once and keep it in your secrets store. Losing it means you cannot open
// payments sent to your address; leaking it lets someone else read them.
async function loadReceiveKey(): Promise<ReceiveKey> {
  if (process.env.GLOAM_RECEIVE_KEY) return JSON.parse(process.env.GLOAM_RECEIVE_KEY) as ReceiveKey;
  const key = await generateReceiveKey();
  console.log("New receive key. Store this JSON as GLOAM_RECEIVE_KEY in your secrets, then run again:");
  console.log(JSON.stringify(key));
  process.exit(0);
}

// ── 2. A request link per agent ─────────────────────────────────────────────────
function topUpLink(key: ReceiveKey, agentId: string, amountUsdg?: string): string {
  return buildPaymentRequestLink({
    payTo: key.tag,
    network,
    asset: "USDG", // on Tempo: "USDC.e", "pathUSD", "USDT0" or "OUSD"
    amount: amountUsdg, // leave out to let the user choose
    note: `agent:${agentId}`, // at most 80 characters, only your key reads it
    name: "Your service",
  });
}

// ── Proving: securing a payment is a private transfer, proved here ──────────────
// snarkjs proves from local files in node: download the transfer circuit once and
// check it against the SHA-256 the SDK pins.
async function transferProver() {
  const files = circuitArtifactFiles("transfer", ceremonyForChainId(network.chainId));
  await mkdir("circuits/final", { recursive: true });
  const local = { wasm: `circuits/${files.wasm}`, zkey: `circuits/${files.zkey}` };
  for (const kind of ["wasm", "zkey"] as const) {
    if (!existsSync(local[kind])) {
      const res = await fetch(`${GLOAM_ARTIFACTS_URL}/${files[kind]}`);
      if (!res.ok) throw new Error(`Could not download ${files[kind]}: ${res.status}`);
      await writeFile(local[kind], Buffer.from(await res.arrayBuffer()));
    }
    const sha = createHash("sha256").update(await readFile(local[kind])).digest("hex");
    if (sha !== files.sha256[kind]) throw new Error(`${local[kind]} does not match the pinned SHA-256. Delete it and run again.`);
  }
  return artifactProver(local);
}

// ── Your own records (replace with your database) ───────────────────────────────
const credited = new Set<string>(); // payment commitments already credited
async function saveFreshNote(fresh: NoteExport) {
  // The fresh note's secret IS the money once the payment is secured. Persist it
  // durably before anything is sent; if the process dies after sending, this is
  // the only copy.
  await writeFile(`notes/${fresh.commitment}.json`, JSON.stringify(fresh));
}
async function creditAgent(agentId: string, amountWei: string, payment: IncomingPayment) {
  console.log(`Credit agent ${agentId}: ${formatUnits(BigInt(amountWei), 6)} USDG (payment ${payment.commitment})`);
}

// ── 4. Secure, then credit ──────────────────────────────────────────────────────
async function secureAndCredit(payment: IncomingPayment, prove: Awaited<ReturnType<typeof transferProver>>) {
  if (credited.has(payment.commitment)) return;
  const agentId = payment.note?.startsWith("agent:") ? payment.note.slice("agent:".length) : null;
  if (!agentId) {
    console.log(`Payment ${payment.commitment} has no agent note. Secure it, then sort it out by hand.`);
  }

  // Until it is secured, the payer (who made the payment's secret) could still
  // spend it back. sweepReceivedNote moves it into a note only you know, through
  // the Gloam relay, so your server needs no gas and never shows up on chain.
  const result = await sweepReceivedNote({
    note: await notePackageToExport(payment.notePackage),
    poolAddress: network.pool,
    chainId: network.chainId,
    prove,
    chain: sweepChainFromClient(client, { pool: network.pool, fromBlock: network.deployBlock }),
    submit: relaySubmitter(),
    beforeSubmit: (fresh) => saveFreshNote(fresh),
  });

  if (result.final) {
    credited.add(payment.commitment);
    if (agentId) await creditAgent(agentId, payment.amountWei, payment);
    return;
  }
  // already_spent: the payer took it back first, or it was secured before. Credit nothing.
  // not_settled, failed or unconfirmed: keep the payment and try again on the next pass.
  console.log(`Not credited yet (${result.status}): ${result.reason ?? ""}`);
}

// ── 3a. Where a board exists: watch for payments ────────────────────────────────
async function watch(key: ReceiveKey) {
  const prove = await transferProver();
  let from: bigint | undefined; // persist this between restarts
  for (;;) {
    const { payments, scannedTo } = await scanIncomingPayments({ client, network, receiveKey: key, fromBlock: from });
    for (const p of payments) await secureAndCredit(p, prove);
    from = scannedTo + 1n;
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

// ── 3b. Fallback: a sealed code the payer hands over directly ──────────────────
export async function handleCode(key: ReceiveKey, sealedCode: string) {
  const check = await openIncomingPayment({ client, network, receiveKey: key, sealedTicket: sealedCode });
  if (check.status === "already_spent") return "This payment was already claimed.";
  if (check.status === "not_in_vault_yet") return "This payment has not landed yet. Try again in a minute.";
  await secureAndCredit(check.payment, await transferProver());
  return `Received ${formatUnits(BigInt(check.payment.amountWei), 6)} for ${check.payment.note ?? "no note"}.`;
}

// ── Main ────────────────────────────────────────────────────────────────────────
const key = await loadReceiveKey();
await mkdir("notes", { recursive: true });
console.log("Your Gloam address:", key.tag);
console.log("Top-up link for agent 42:", topUpLink(key, "42", "25"));

if (payMemoBoardFor(network.chainId)) {
  await watch(key);
} else {
  console.log(`${network.label} has no payment-message board: pass the codes payers hand over to handleCode().`);
  const code = process.argv[2]; // npx tsx receive-and-credit.ts gloam2t.…
  if (code) console.log(await handleCode(key, code));
}
