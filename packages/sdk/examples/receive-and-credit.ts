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
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPublicClient, formatUnits, http, type Hex } from "viem";
import {
  artifactProver,
  buildPaymentRequestLink,
  circuitArtifactFiles,
  ceremonyForChainId,
  findRequestAsset,
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
const chain = sweepChainFromClient(client, { pool: network.pool, fromBlock: network.deployBlock });

// The token you credit. Anyone can pay your address in any token the vault takes,
// and an amount is in that token's base units (GLOAM has 18 decimals, USDG 6), so
// only a payment in this token is credited, read with its decimals.
const CREDIT_ASSET = findRequestAsset(network, "USDG")!; // on Tempo: "USDC.e", "pathUSD", "USDT0" or "OUSD"

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
    asset: CREDIT_ASSET.symbol,
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
const settled = new Set<string>(); // payment commitments secured and dealt with
async function saveFreshNote(fresh: NoteExport) {
  // The fresh note's secret IS the money once the payment is secured. Persist it
  // durably before anything is sent; if the process dies after sending, this is
  // the only copy.
  await writeFile(`notes/${fresh.commitment}.json`, JSON.stringify(fresh));
}
async function creditAgent(agentId: string, amount: string, payment: IncomingPayment) {
  console.log(`Credit agent ${agentId}: ${amount} ${CREDIT_ASSET.symbol} (payment ${payment.commitment})`);
}

/** What a secured payment credits: the agent and the amount, or why it credits nothing. */
export function creditFor(payment: IncomingPayment): { agentId: string; amount: string } | { skip: string } {
  if (payment.asset.toLowerCase() !== CREDIT_ASSET.address.toLowerCase()) {
    return { skip: `it is in ${findRequestAsset(network, payment.asset)?.symbol ?? payment.asset}, not ${CREDIT_ASSET.symbol}` };
  }
  const agentId = payment.note?.startsWith("agent:") ? payment.note.slice("agent:".length) : "";
  if (!agentId) return { skip: "it has no agent note" };
  return { agentId, amount: formatUnits(BigInt(payment.amountWei), CREDIT_ASSET.decimals) };
}

/** A payment found but not finished yet. Keep it with `from`: openIncomingPayment rebuilds it from the code. */
interface Unfinished {
  sealedTicket: string;
  /** Fresh notes already sent for it: a sweep that did not confirm may still land. */
  fresh: Hex[];
}

// ── 4. Secure, then credit ──────────────────────────────────────────────────────
/** Returns true once the payment is finished (secured and dealt with, or known not yours); false to try again. */
async function secureAndCredit(payment: IncomingPayment, prove: Awaited<ReturnType<typeof transferProver>>, pending: Unfinished): Promise<boolean> {
  if (settled.has(payment.commitment)) return true;
  const sweptEarlier = async () => {
    for (const c of pending.fresh) if (await chain.isCommitmentSeen(c)) return true;
    return false;
  };

  // Until it is secured, the payer (who made the payment's secret) could still
  // spend it back. sweepReceivedNote moves it into a note only you know, through
  // the Gloam relay, so your server needs no gas and never shows up on chain.
  let final = await sweptEarlier();
  if (!final) {
    const result = await sweepReceivedNote({
      note: await notePackageToExport(payment.notePackage),
      poolAddress: network.pool,
      chainId: network.chainId,
      prove,
      chain,
      submit: relaySubmitter(),
      beforeSubmit: async (fresh) => {
        await saveFreshNote(fresh);
        pending.fresh.push(fresh.commitment);
      },
    });
    // already_spent can also mean an earlier sweep of yours landed in the meantime.
    final = result.final || (result.status === "already_spent" && (await sweptEarlier()));
    if (!final) {
      console.log(`Not credited (${result.status}): ${result.reason ?? ""}`);
      // already_spent: the payer took it back first. bad_note: not a real payment. Nothing to credit, ever.
      // not_settled, failed or unconfirmed: try again on the next pass.
      return result.status === "already_spent" || result.status === "bad_note";
    }
  }

  settled.add(payment.commitment);
  const credit = creditFor(payment);
  if ("skip" in credit) console.log(`Payment ${payment.commitment} is secured but not credited: ${credit.skip}. Sort it out by hand.`);
  else await creditAgent(credit.agentId, credit.amount, payment);
  return true;
}

// ── 3a. Where a board exists: watch for payments ────────────────────────────────
async function watch(key: ReceiveKey) {
  const prove = await transferProver();
  // Persist both between restarts: where the scan got to, and the payments it
  // found that are not finished. Moving `from` past a payment whose sweep did not
  // finish would drop it for good.
  let from: bigint | undefined;
  const unfinished = new Map<string, Unfinished>(); // by payment commitment
  for (;;) {
    for (const [commitment, pending] of unfinished) {
      const check = await openIncomingPayment({ client, network, receiveKey: key, sealedTicket: pending.sealedTicket });
      if (check.status === "not_in_vault_yet") continue;
      if (await secureAndCredit(check.payment, prove, pending)) unfinished.delete(commitment);
    }
    const { payments, scannedTo } = await scanIncomingPayments({ client, network, receiveKey: key, fromBlock: from });
    for (const p of payments) {
      if (unfinished.has(p.commitment)) continue;
      const pending: Unfinished = { sealedTicket: p.sealedTicket, fresh: [] };
      if (!(await secureAndCredit(p, prove, pending))) unfinished.set(p.commitment, pending);
    }
    from = scannedTo + 1n;
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

// ── 3b. Fallback: a sealed code the payer hands over directly ──────────────────
export async function handleCode(key: ReceiveKey, sealedCode: string) {
  const check = await openIncomingPayment({ client, network, receiveKey: key, sealedTicket: sealedCode });
  if (check.status === "already_spent") return "This payment was already claimed.";
  if (check.status === "not_in_vault_yet") return "This payment has not landed yet. Try again in a minute.";
  const finished = await secureAndCredit(check.payment, await transferProver(), { sealedTicket: check.payment.sealedTicket, fresh: [] });
  if (!finished) return "This payment is not secured yet. Try again in a minute.";
  if (!settled.has(check.payment.commitment)) return "This payment was taken back by the payer, or is not a real payment. Nothing was credited.";
  const credit = creditFor(check.payment);
  return "skip" in credit ? `Secured, not credited: ${credit.skip}.` : `Received ${credit.amount} ${CREDIT_ASSET.symbol} for agent ${credit.agentId}.`;
}

// ── Main ────────────────────────────────────────────────────────────────────────
async function main() {
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
}

// Runs when the file is run, not when something imports creditFor from it.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
