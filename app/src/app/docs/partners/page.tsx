import type { Metadata } from "next";
import Link from "next/link";
import { DocsLayout } from "@/components/DocsLayout";

export const metadata: Metadata = {
  title: "Partner program and API",
  description:
    "Add private payments to your app with a Gloam API key, set your own fee, and see attributed volume and commissions. Full v1 API reference with curl examples. Partner fees are not charged yet, on mainnet or testnet.",
};

const ERRORS: [string, number | string, string][] = [
  ["missing_key", 401, "No Authorization header. Send Authorization: Bearer gloam_live_... (mainnet) or gloam_test_... (testnet)"],
  ["invalid_key", 401, "Not a Gloam key, or a key that was revoked or rotated."],
  ["key_env_mismatch", 403, "A live key on a testnet, or a test key on a mainnet."],
  ["rate_limited", 429, "Over 300 requests in a minute for this key. Retry-After says when to retry."],
  ["invalid_json", 400, "The body is not a JSON object."],
  ["bad_request", 400, "A relay field is malformed (proof, root, nullifier, commitments, asset, to, amount, memo). Relayed memos are capped at 2,048 bytes."],
  ["network", 400, "chainId is not a network the relay serves (4663 or 4217 on mainnet, 46630 or 42431 on testnet)."],
  ["bad_action", 400, "action is not transfer, unshield or memo."],
  ["screened", 403, "A cash out to a sanctioned address. The relay says nothing more."],
  ["asset_policy", 403, "On Tempo, the token issuer's policy blocks this cash out."],
  ["AlreadySpent", 409, "The note was already spent."],
  ["UnknownRoot", 409, "The proof was made against a vault state the pool no longer knows. Resync and prove again."],
  ["not_seen", 409, "A payment message for a payment that is not in the vault yet."],
  ["in_flight", 409, "The same proof is already being relayed. Wait for that send to finish instead of retrying."],
  ["vault_recipient", 400, "A cash out to the vault or the memo board itself. Pick a wallet address instead."],
  ["InvalidProof, InsufficientPoolBalance, ...", 422, "The dry run against the pool reverted, with the pool's own reason. Nothing was sent."],
  ["relay_off, relay_empty", 503, "The relay is not set up, or out of gas, on this network."],
  ["rpc", 502, "The network did not answer. Try again."],
  ["bad_tx, tx_not_found, tx_failed, not_a_deposit, too_old", "400 to 422", "Deposit attribution: the hash is malformed, not found, failed, not a deposit into Gloam's vault, or older than 24 hours."],
  ["already_attributed", 409, "That deposit is already counted to a partner."],
  ["invalid_proof", 400, "Not a Gloam proof, or a damaged one."],
  ["bad_tag, unknown_network, unknown_asset, bad_amount", 400, "Payment request fields."],
  ["no_live_pool, unknown_network", 404, "No live vault on that network, or an unknown network in the path."],
  ["unavailable", 503, "Reading the vault took too long. Try again shortly."],
  ["keys_unconfigured, storage_unavailable", 503, "The server is missing its key pepper or its store."],
  ["internal", 500, "Our fault. The requestId helps us find it."],
];

export default function DocsPartnersPage() {
  return (
    <DocsLayout
      title="Partner program and API"
      lede="Add private payments to your app with one API key. You set your own fee, and every payment your key brings in is counted to you as it happens. Partner fees are not charged yet, on mainnet or testnet."
      glance={[
        { label: "Base URL", value: "https://gloam.trade/api/v1" },
        { label: "Auth", value: "Bearer API key" },
        { label: "Format", value: "JSON, version 1" },
        { label: "Partner fees", value: "Not charged yet" },
      ]}
      quickLinks={[
        { href: "/partners", label: "Partner program" },
        { href: "/partners/dashboard", label: "Open the portal" },
        { href: "/docs/sdk", label: "SDK" },
        { href: "/docs/privacy-model", label: "What stays private" },
      ]}
    >
      <h2>How the program works</h2>
      <p>
        Your users keep their own keys and their own money. They prove each payment
        in their browser or agent with the <Link href="/docs/sdk">SDK</Link>. Your
        server sends the proven payment through the Gloam relay with your API key,
        and that is how a payment is counted to you.
      </p>
      <ul>
        <li>
          <strong>Sign in</strong> at <Link href="/partners/dashboard">/partners/dashboard</Link>{" "}
          with your wallet. You sign a short message (Sign-In with Ethereum); it
          costs nothing and moves no money.
        </li>
        <li>
          <strong>Make a key.</strong> It is shown once. Gloam keeps only a keyed
          fingerprint of it (HMAC-SHA256 with a server secret), so nobody can read
          it back. Rename, rotate (a new secret, the old one stops at once) or
          revoke it any time.
        </li>
        <li>
          <strong>Set your fee</strong> and a payout address per network.
        </li>
        <li>
          <strong>Relay payments with the key.</strong> The portal shows your
          volume, your would-be fees and every payment, updated every 20 seconds.
        </li>
      </ul>

      <h2>What you can charge, and why</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Payment</th>
              <th>Your fee</th>
              <th>Limit</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Private payment</td>
              <td>Flat, per payment</td>
              <td>$0.00 to $1.00</td>
              <td>The amount is hidden from everyone, the relay included, so a share of it cannot be worked out.</td>
            </tr>
            <tr>
              <td>Cash out</td>
              <td>Share of the amount</td>
              <td>0% to 1%</td>
              <td>The token and amount leaving the vault are public on chain.</td>
            </tr>
            <tr>
              <td>Deposit</td>
              <td>Share of the amount</td>
              <td>0% to 1%</td>
              <td>The token and amount entering the vault are public too.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Fees are in the token the user moved, paid to your payout address on that
        network. A payment message (the encrypted heads-up after a private
        payment) carries no fee. A change to your setting applies to new payments;
        earlier ones keep the fee they were counted with.
      </p>

      <h2>Partner fees: not charged yet</h2>
      <p>
        Gloam runs on Robinhood Chain and Tempo mainnet, and on their testnets.
        On every network, the portal records what your key brought in and the fee
        your setting would have earned, and every figure is labeled that way. No
        partner fee is taken from anyone, and every API response says{" "}
        <code>&quot;charged&quot;: false</code>.
      </p>
      <p>
        Gloam&apos;s own fee is separate. On mainnet a cash out costs 0.25%, kept
        by the vault; deposits and private payments are free. Your partner fee is
        not added on top of that yet.
      </p>
      <p>
        Taking a partner fee for real needs a fee output inside the
        zero-knowledge circuits and the vault contract, so the fee is part of the
        proof and nobody can skip or change it. The mainnet pools do not have
        that yet (see the <Link href="/docs/production">production gate</Link>).
        Until then, a dashboard figure is an attribution count, not money owed.
      </p>
      <p>
        USD figures use $1 for stablecoins and the live ETH price at the time of the
        payment. Stock tokens are counted but not valued.
      </p>

      <h2>Authentication and limits</h2>
      <p>
        Send the key in the <code>Authorization</code> header on every call except
        the index at <code>GET /api/v1</code>. Live keys (<code>gloam_live_</code>)
        work on the mainnets; test keys (<code>gloam_test_</code>) on the testnets.
        Keep the key on your server: the API sends no CORS headers, so browsers on
        other sites cannot call it.
      </p>
      <pre>
        <code>{`curl https://gloam.trade/api/v1/me \\
  -H "Authorization: Bearer $GLOAM_API_KEY"`}</code>
      </pre>
      <p>
        Each key gets 300 requests a minute across every endpoint. Responses carry{" "}
        <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code> and{" "}
        <code>X-RateLimit-Reset</code> (unix seconds); a 429 adds{" "}
        <code>Retry-After</code>. The relay also keeps its own per-sender and
        per-network caps, with your key as the sender.
      </p>

      <h2>Responses and errors</h2>
      <p>
        Every response is JSON in the same envelope, with{" "}
        <code>Cache-Control: no-store</code> and a <code>Gloam-Api-Version: 1</code>{" "}
        header. Quote the <code>requestId</code> when you ask us about a call.
      </p>
      <pre>
        <code>{`// success
{ "v": 1, "ok": true, "data": { ... }, "requestId": "req_5e0c2a91d4b7f310" }

// failure
{ "v": 1, "ok": false,
  "error": { "code": "invalid_key", "message": "This API key is not valid. It may have been revoked or rotated." },
  "requestId": "req_9b3f..." }`}</code>
      </pre>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Status</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {ERRORS.map(([code, status, meaning]) => (
              <tr key={code}>
                <td>
                  <code>{code}</code>
                </td>
                <td>{status}</td>
                <td>{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Relay a payment</h2>
      <p>
        <code>POST /api/v1/relay</code> takes the same body as the app&apos;s own
        relay. It screens, dry-runs and submits exactly as the app does, then
        counts the payment to you. The proof is the authorization and a cash
        out&apos;s recipient is fixed inside it, so the relay can only submit or
        refuse a payment, never redirect it.
      </p>
      <pre>
        <code>{`# a live key on mainnet (4663, 4217), a test key on testnet (46630, 42431)

# a private payment (transfer): counted as a private payment, flat fee
curl https://gloam.trade/api/v1/relay \\
  -H "Authorization: Bearer $GLOAM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "chainId": 4663,
    "action": "transfer",
    "proof": "0x...", "root": "0x...", "nullifier": "0x...",
    "commitments": ["0x...", "0x..."]
  }'

# a cash out (unshield): counted with its public token and amount
  -d '{ "chainId": 4217, "action": "unshield", "proof": "0x...", "root": "0x...",
        "nullifier": "0x...", "asset": "0x20c0...", "to": "0xRecipient", "amount": "250000000" }'

# a payment message (memo, on testnet): relayed, not counted
  -d '{ "chainId": 46630, "action": "memo", "paymentCommitment": "0x...", "memo": "0x..." }'`}</code>
      </pre>
      <pre>
        <code>{`{
  "v": 1, "ok": true,
  "data": {
    "hash": "0x9c1e...",
    "chainId": 4663, "network": "robinhood-mainnet", "action": "transfer",
    "attribution": {
      "recorded": true,
      "kind": "private_payment",
      "activity": {
        "id": "act_...", "kind": "private_payment", "network": "robinhood-mainnet",
        "txHash": "0x9c1e...", "ts": 1791302400000,
        "asset": null, "amount": null, "volumeUsd": null,
        "feeUsd": 0.05, "feeToken": null, "feeBasis": "$0.05 per private payment"
      }
    },
    "charged": false
  },
  "requestId": "req_..."
}`}</code>
      </pre>
      <p>
        The hash comes back as soon as the transaction is sent; wait for the
        receipt yourself. <code>attribution.recorded</code> is false with a reason
        (<code>not_billable</code> for memos) when nothing was counted; a payment
        that was sent is never failed over accounting. <code>GET /api/v1/relay</code>{" "}
        says which networks the relay can submit on right now.
      </p>

      <h2>Count a deposit</h2>
      <p>
        Deposits come from the user&apos;s own wallet, not the relay, so your app
        reports them: <code>POST /api/v1/deposits</code> with the transaction hash.
        The server reads the transaction from the chain. It must be a successful
        deposit into Gloam&apos;s vault, at most 24 hours old, and not already
        counted to anyone; the first partner to report it gets it.
      </p>
      <pre>
        <code>{`curl https://gloam.trade/api/v1/deposits \\
  -H "Authorization: Bearer $GLOAM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "chainId": 4663, "txHash": "0x..." }'

# 201: { "v": 1, "ok": true, "data": { "activity": { "kind": "deposit", "symbol": "USDG", "amount": "250000000", ... }, "charged": false } }`}</code>
      </pre>

      <h2>Your volume and fees</h2>
      <p>
        <code>GET /api/v1/activity?limit=50</code> returns what the portal shows:
        totals, counts by kind and network, public volume and would-be fees by
        token, the last 14 days, and up to 200 recent payments.
      </p>
      <pre>
        <code>{`{
  "totals": { "privatePayments": 128, "cashOuts": 9, "deposits": 4,
              "publicVolumeUsd": 5210.5, "commissionUsd": 19.43, "unpriced": 0 },
  "byNetwork": { "robinhood": { "private_payment": 90, ... }, "tempo": { ... } },
  "byAsset": [ { "symbol": "USDG", "network": "robinhood", "volume": "4210.5", "commission": "8.42" } ],
  "daily": [ { "day": "2026-10-06", "privatePayments": 12, "cashOuts": 1, "deposits": 0,
               "volumeUsd": 250, "commissionUsd": 1.23 } ],
  "recent": [ ... ],
  "fees": { "privatePaymentCents": 5, "cashoutBps": 25, "depositBps": 0 },
  "charged": false
}`}</code>
      </pre>

      <h2>Vaults and the leaf list</h2>
      <p>
        <code>GET /api/v1/vaults</code> (or one network:{" "}
        <code>/vaults/robinhood-mainnet</code>, <code>/vaults/tempo-mainnet</code>,{" "}
        <code>/vaults/robinhood</code>, <code>/vaults/tempo</code>) gives each
        network&apos;s vault address, the
        tokens it takes, whether the relay is up, and a fresh read of the tree size
        and root, plus <code>leafCapacity</code> and <code>leavesLeft</code> for
        how much room the note tree has.
      </p>
      <p>
        <code>GET /api/v1/vaults/&#123;network&#125;/leaves</code> is the vault&apos;s
        public leaf list: every commitment in order, with its leaf index, block and
        transaction. Rebuild the Merkle tree from it and check the root with the
        pool&apos;s <code>isKnownRoot</code> before you prove against it; the SDK&apos;s{" "}
        <code>syncTree</code> does the same from the chain.
      </p>
      <pre>
        <code>{`curl https://gloam.trade/api/v1/vaults/tempo-mainnet \\
  -H "Authorization: Bearer $GLOAM_API_KEY"

# data.vault: { "network": "tempo-mainnet", "chainId": 4217, "pool": "0x...",
#   "assets": [ { "symbol": "USDC.e", ... } ], "relay": { "enabled": true, ... },
#   "chain": { "block": "37...", "leafCount": 412, "root": "0x..." } }`}</code>
      </pre>

      <h2>Check a proof</h2>
      <p>
        <code>POST /api/v1/proofs/verify</code> checks a proof of funds (
        <code>gloamfunds1:</code>), proof of payment (<code>gloampay1:</code>),
        payroll total (<code>gloamroll1:</code>) or exact balance (
        <code>gloambal1:</code>) on the server, with the same checks the{" "}
        <Link href="/verify">/verify</Link> page runs: the zero-knowledge proof, who
        it was made for, that it points at Gloam&apos;s own vault, that its plain
        fields match, and the live chain checks. <code>ok</code> is true only when
        every check passes and the proof has not expired.
      </p>
      <pre>
        <code>{`curl https://gloam.trade/api/v1/proofs/verify \\
  -H "Authorization: Bearer $GLOAM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "proof": "gloamfunds1:eyJ2IjoxLCJraW5kIjoi..." }'

# data: { "format": "gloamfunds1", "kind": "funds", "ok": true, "expired": false,
#   "checks": [ { "label": "The proof checks out", "state": "pass", ... },
#               { "label": "Made for \\"Acme Bank\\"", "state": "pass", ... }, ... ],
#   "claims": { "chainId": 4663, "asset": "0x5fc5...", "threshold": "1000000000", ... } }`}</code>
      </pre>

      <h2>Payment request links</h2>
      <p>
        <code>POST /api/v1/payment-requests</code> makes a link that opens Pay in the
        Gloam app with the details filled in. The details ride after the{" "}
        <code>#</code>, so the payer&apos;s browser never sends them to a server.
        This endpoint builds the link and keeps nothing; you can also build the same
        link yourself (see <Link href="/docs/private-pay">private pay</Link>).
      </p>
      <pre>
        <code>{`curl https://gloam.trade/api/v1/payment-requests \\
  -H "Authorization: Bearer $GLOAM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "to": "gloamr1.AbC...", "network": "robinhood-mainnet", "asset": "USDG",
        "amount": "1250", "note": "Invoice 042", "name": "Acme" }'

# 201: data.url = "https://gloam.trade/app/vault?tab=move&mode=pay#to=gloamr1...&amount=1250&asset=0x5fc5..."`}</code>
      </pre>

      <h2>Public figures</h2>
      <p>
        <code>GET /api/v1/stats</code> returns what{" "}
        <Link href="/transparency">/transparency</Link> shows for each network: what
        the vault holds, and counts of deposits, private transfers, cash outs and
        payment messages. Aggregates only, cached about a minute.
      </p>

      <h2>With the SDK</h2>
      <p>
        <code>GloamApiClient</code> in <code>@gloamtrade/sdk</code> wraps every
        endpoint, unwraps the envelope and throws <code>GloamApiError</code> with the
        code, status and request id.
      </p>
      <pre>
        <code>{`import { GloamApiClient, settleGloamPayment } from "@gloamtrade/sdk";

const gloam = new GloamApiClient({ apiKey: process.env.GLOAM_API_KEY! });

await gloam.me();                                   // test the key
const { hash, attribution } = await gloam.relay(sendIntent);
await gloam.attributeDeposit({ chainId: 4663, txHash });
const report = await gloam.verifyProof(proofText);
const { url } = await gloam.paymentRequest({ to, asset: "USDG", amount: "25" });

// x402 sellers: sweep received payments through the relay with your key
await settleGloamPayment({ ...params, submit: gloam.submitter() });`}</code>
      </pre>

      <h2>What is recorded</h2>
      <ul>
        <li>
          <strong>Per payment:</strong> network, kind, transaction hash, time, the
          key that sent it, and the fee your setting gave it.
        </li>
        <li>
          <strong>Only for deposits and cash outs:</strong> the token and amount,
          which the chain already shows.
        </li>
        <li>
          <strong>Never:</strong> notes, secrets, balances, private amounts, or who
          received a private payment. Your API key is never stored, only its keyed
          fingerprint.
        </li>
      </ul>
    </DocsLayout>
  );
}
