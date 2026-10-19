import type { Metadata } from "next";
import Link from "next/link";
import { DocsLayout } from "@/components/DocsLayout";

export const metadata: Metadata = {
  title: "Threat model",
  description:
    "Who Gloam defends against, what each of them can and cannot do, what we assume, and the gaps we know about. Written for security researchers.",
};

const ACTORS: { who: string; can: string; cannot: string }[] = [
  {
    who: "Anyone watching the chain",
    can: "See every deposit and cash out (wallet, asset, amount), who sent each transaction and when, and try to match deposits to exits by amount and timing.",
    cannot: "Tell which note a spend used, see the amount or parties of a private send, or see what anyone holds in the vault.",
  },
  {
    who: "The Gloam relay",
    can: "See your IP address and the timing of the transactions it sends for you, and refuse to send one.",
    cannot: "Change a cash out's recipient or amount, which the proof binds, learn a note secret, or move money.",
  },
  {
    who: "RPC providers",
    can: "See the reads the app makes through them, including a check on whether one specific payment has been spent.",
    cannot: "See note secrets, or anything the chain does not already show.",
  },
  {
    who: "The Gloam team and contract owner",
    can: "Change proof, price or rate rules after a 3-day public timelock, lower deposit limits at once on the mainnet vault, and change the web app you load.",
    cannot: "Move pooled funds. There is no admin withdraw, and no rule change takes effect without 3 days of public notice.",
  },
  {
    who: "Someone who pays you",
    can: "Spend the payment back before you claim it, since they made its secret.",
    cannot: "Take it back once you have claimed it. Claiming moves it into a new note only you know.",
  },
  {
    who: "Anyone holding a claim link",
    can: "Claim it. A plain link is like cash. A locked link also needs its phrase, which a weak phrase does not protect for long.",
    cannot: "Claim a payment sealed to a Gloam address. Only that address's owner can open it.",
  },
  {
    who: "Someone with your device or browser",
    can: "Use an unlocked session, or read your notes if they control the browser while it is open.",
    cannot: "Read your notes from storage alone. They are encrypted under a key the browser will not export, or under your passkey.",
  },
  {
    who: "Gloam's recovery store",
    can: "See a backup's id, a hash of its write token, its size and when it changes.",
    cannot: "Open it. The key comes from your wallet signature or passkey and never reaches the server.",
  },
  {
    who: "A stablecoin issuer",
    can: "Pause its coin or block the vault, so no balance in that coin can be cashed out until it lifts the block. Some token standards also let an issuer burn a blocked holder's balance.",
    cannot: "See inside the vault, or tell whose money is in it.",
  },
  {
    who: "Whoever ran the trusted setup",
    can: "On testnet, forge proofs if they kept the setup's secret, and so drain the pool.",
    cannot: "Do the same at mainnet, provided one contributor to the multi-party ceremony is honest.",
  },
];

export default function DocsThreatModelPage() {
  return (
    <DocsLayout
      title="Threat model"
      lede="Who we defend against, what each of them can and cannot do, what we assume, and the gaps we know about. Written for security researchers. If you just want to know what an explorer shows, start with What stays private."
      glance={[
        { label: "Network", value: "Testnet today" },
        { label: "Bounty", value: "None yet, credit by name" },
        { label: "Report to", value: "hello@gloam.trade" },
        { label: "Fork tests", value: "Welcome" },
      ]}
    >
      <h2 id="protect">What we protect</h2>
      <ul>
        <li>The link between a deposit and any later spend or cash out.</li>
        <li>Who paid whom, and how much, for a private send inside the vault.</li>
        <li>What anyone holds while their money is in the vault.</li>
        <li>Payment notes and receive keys on the user&apos;s own device.</li>
        <li>The vault itself: nobody takes out more than was put in.</li>
      </ul>
      <p>
        Some things are public by design and we do not try to hide them: deposits and
        cash outs, the wallet that sent each transaction, timing, and the opaque hashes
        every payment adds to the vault. <Link href="/docs/privacy-model">What stays private</Link>{" "}
        walks through exactly what an explorer shows.
      </p>

      <h2 id="actors">Who can do what</h2>
      <div className="overflow-x-auto">
        <table className="min-w-[760px] [&_th]:whitespace-normal">
          <thead>
            <tr>
              <th>Who</th>
              <th>Can</th>
              <th>Cannot</th>
            </tr>
          </thead>
          <tbody>
            {ACTORS.map((a) => (
              <tr key={a.who}>
                <td>
                  <strong>{a.who}</strong>
                </td>
                <td>{a.can}</td>
                <td>{a.cannot}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="details">The details that matter</h2>
      <h3>Amount and timing</h3>
      <p>
        A shielded pool hides you in a crowd. If you deposit 137 and someone cashes out
        137 an hour later, an observer will guess it was you, and the proof cannot stop
        that. The crowd is small on testnet, so treat unlinkability as weak until more
        people use the vault. Splitting amounts and waiting before you cash out help.
      </p>

      <h3>The relay</h3>
      <p>
        The relay pays gas so your wallet does not appear as the sender of a private
        send or cash out. It checks every payment before sending it, keeps per-device and
        per-network rate limits keyed by IP address, and cannot alter what the proof
        binds. If it refuses or goes down, you can turn it off and send from your own
        wallet, at the cost of your wallet showing as the sender. On Robinhood Chain, a
        payment message you post yourself shows your wallet as the poster. Through the
        relay it does not.
      </p>

      <h3>Owner powers</h3>
      <p>
        After setup, the owner can change how proofs, prices or rates are checked only
        by queueing the change on-chain, where anyone can see it, and running it three
        days later. A harmful change, such as a bad verifier, gives everyone three days to
        cash out first. On the mainnet vault the owner can also lower deposit limits at
        once, down to zero. That can stop new deposits during an incident, never
        withdrawals or private sends. The owner is a single wallet today. Mainnet moves it
        to a multisig.
      </p>

      <h3>The web app</h3>
      <p>
        Your notes are made and stored by the code you load from gloam.trade, so a
        malicious or compromised build could read them. That is a trust assumption, not
        something the cryptography removes. The code is open source, the app checks the
        circuit files it downloads against fixed fingerprints, and you can run the SDK
        yourself instead of the hosted app.
      </p>

      <h3>Claim links and phrases</h3>
      <p>
        A claim link carries the payment&apos;s secret in the part after <code>#</code>,
        which browsers do not send to servers, and our analytics drop everything after{" "}
        <code>?</code> and <code>#</code>. A locked link is encrypted with a key stretched
        from its phrase (PBKDF2, 120,000 rounds), but anyone holding the link can keep
        guessing offline, so the phrase is only as strong as its words.
      </p>

      <h3>Proofs you share</h3>
      <p>
        A proof of funds, payment or payroll total shows exactly what it states and names
        who it is for, until it expires. It reveals nothing about other notes. Whoever
        receives it can forward it, and the name inside shows who it was made for.
      </p>

      <h3>Agents</h3>
      <p>
        The MCP server an agent owner runs keeps the agent&apos;s note secrets in an
        encrypted store on that machine, and the agent only ever handles references to
        them. Spending limits are enforced by that server, so a compromised host can
        ignore them. The hosted Gloam tools hold no secrets: they verify proofs, build
        payment requests and read vault stats.
      </p>

      <h2 id="assumptions">What we assume</h2>
      <ul>
        <li>Groth16 and the Poseidon hash are sound, and our circuits enforce what we say they do.</li>
        <li>At least one contributor to the mainnet trusted setup destroys their secret.</li>
        <li>Tempo, Robinhood Chain and the stablecoin contracts behave as documented.</li>
        <li>The browser&apos;s built-in cryptography is correct, and the device is not compromised.</li>
      </ul>

      <h2 id="gaps">Known gaps</h2>
      <ul>
        <li>
          <strong>Dev-ceremony keys on testnet.</strong> Testnet proving keys had one
          contributor. The multi-party ceremony for mainnet is done, with 13
          contributors, and mainnet uses its keys.
        </li>
        <li>
          <strong>Internal audits only.</strong> Several internal rounds, with fixes
          deployed. No external audit yet.
        </li>
        <li>
          <strong>Small anonymity set.</strong> Few people use the testnet vaults.
        </li>
        <li>
          <strong>Read metadata.</strong> Checking whether a specific payment was spent
          goes through a public RPC, which can tie your IP address to that payment.
        </li>
        <li>
          <strong>Single-wallet owner.</strong> Moves to a multisig at mainnet.
        </li>
        <li>
          <strong>Private trade is off.</strong> Its accounting needs a redesign before it
          comes back.
        </li>
      </ul>

      <h2 id="out-of-scope">Out of scope</h2>
      <ul>
        <li>Linking you through information you share yourself, or cashing out to an address tied to your name.</li>
        <li>Social engineering, phishing for your recovery signature, or a compromised device.</li>
        <li>Attacks that only slow down public RPCs or the chain itself.</li>
      </ul>

      <h2 id="report">How to report</h2>
      <p>
        Email <a href="mailto:hello@gloam.trade">hello@gloam.trade</a> with
        &quot;Security&quot; in the subject, or DM{" "}
        <a href="https://x.com/gloamtrade">@gloamtrade</a>. Include the contract, route or
        page, exact steps or a proof of concept, and the impact. Tests on a fork or a
        local chain are ideal. Please do not attack the live service or touch other
        people&apos;s notes.
      </p>
      <p>
        Gloam has no paid bug bounty yet. We reply within three days, credit you by name
        once a fix ships, and you are free to publish what you found after that. The full
        policy is in the repository&apos;s <code>SECURITY.md</code>.
      </p>
    </DocsLayout>
  );
}
