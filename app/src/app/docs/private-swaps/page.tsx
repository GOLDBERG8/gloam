import type { Metadata } from "next";
import Link from "next/link";
import { AppLink } from "@/components/AppLink";
import { DocsLayout } from "@/components/DocsLayout";
import { FlowDiagram } from "@/components/docs/FlowDiagram";
import { VAULT_SWAP_ROUTERS, VAULT_SWAP_V2_ROUTER } from "@/lib/vaultSwap";

export const metadata: Metadata = {
  title: "Private swaps",
  description:
    "Swap straight from your private balance on Robinhood Chain and Tempo mainnet. Who swapped stays private; the tokens and the amounts are public, like any DEX trade.",
};

const VAULT = "0x39e28cde55cab798874746ac52cb4b5cc99a0194";
const TREASURY = "0xB3900ac9350903218e4c7597bAb0f008F01B30B8";
const RH_V1_ROUTER = "0x34AB06208586A737Bf1607fa996Bc9162271c52d";
/** Private swaps v2 on Robinhood Chain (lib/vaultSwap VAULT_SWAP_V2_ROUTER): the page follows the switch. */
const V2 = Boolean(VAULT_SWAP_V2_ROUTER[4663]);

export default function DocsPrivateSwapsPage() {
  return (
    <DocsLayout
      title="Private swaps"
      lede="Swap one token for another straight from your private balance, on Robinhood Chain and Tempo mainnet. Who swapped stays private. The tokens and the amounts are public, like any trade on a DEX."
      glance={[
        { label: "Where", value: "RH + Tempo mainnet" },
        { label: "Who swapped", value: "Private" },
        { label: "Amounts", value: "Public" },
        { label: "Sent by", value: "The Gloam relay" },
      ]}
    >
      <h2 id="how">How a swap works</h2>
      <FlowDiagram
        title="One swap, one transaction"
        steps={[
          {
            n: "1",
            title: "Out of the vault",
            body: "The vault releases one of your private notes to a one-time escrow address, made for this swap alone.",
          },
          {
            n: "2",
            title: "Swap on a DEX",
            body: "The swap router buys an exact amount of the other token on a public DEX: Uniswap v4 on Robinhood Chain, Tempo's stablecoin exchange on Tempo.",
          },
          {
            n: "3",
            title: "Back in the vault",
            body: "The output goes straight back into the vault as a new private note that only you know.",
          },
        ]}
      />
      <p>
        All three steps run in one transaction. If any step fails, the whole
        swap reverts and nothing moves.
      </p>
      <p>
        The Gloam relay sends the transaction and pays its network fee, so your
        wallet never signs it or shows up next to it. Swaps always go through
        the relay. Sending one from your own wallet would put your wallet right
        next to the swap, so the app does not offer it.
      </p>

      <h2 id="pairs">What you can swap</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Chain</th>
              <th>Pairs</th>
              <th>Where it trades</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Robinhood Chain</td>
              {V2 ? (
                <>
                  <td>
                    USDG, $GLOAM, ETH (held as WETH), USDe, U, cbBTC, VIRTUAL,
                    PONS, CASHCAT and 20 Robinhood stock tokens (SPY, NVDA, TSLA,
                    AAPL and more), any one for another
                  </td>
                  <td>
                    Uniswap v4, in up to three hops over the router&apos;s
                    allowed pools, whichever route pays the most
                  </td>
                </>
              ) : (
                <>
                  <td>USDG and $GLOAM</td>
                  <td>
                    Uniswap v4, in two hops through ETH, or the direct USDG and
                    $GLOAM pool when it pays more
                  </td>
                </>
              )}
            </tr>
            <tr>
              <td>Tempo</td>
              <td>USDC.e, pathUSD, USDT0 and OUSD, any one for another</td>
              <td>Tempo&apos;s stablecoin exchange</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        An example on Tempo: 1 pathUSD gets about 0.9964 USDC.e, after the
        vault fee and the price buffer below. Prices move, so the app always
        shows the live quote.
      </p>
      <p>
        Swaps are on mainnet only. The testnets have no swap router. Stock
        tokens stay on Robinhood Chain testnet and cannot be swapped.
      </p>

      <h2 id="private-public">What stays private and what is public</h2>
      <p>
        <strong>Private:</strong>
      </p>
      <ul>
        <li>Who swapped. The Gloam relay sends it, so your wallet never shows.</li>
        <li>
          Which private balance it came from. The proof shows you own a note in
          the vault, not which one.
        </li>
        <li>Where the new balance goes next. It is a fresh note only you know.</li>
      </ul>
      <p>
        <strong>Public:</strong>
      </p>
      <ul>
        <li>The two tokens and the two amounts, as with any trade on a DEX.</li>
        <li>When it happened, and that it went through the Gloam swap router.</li>
      </ul>
      <p>
        On the explorer, one swap shows as the relay calling the router, the
        vault paying a one-time escrow address, a trade on the DEX, and a
        deposit from the router back into the vault. A private swap hides you,
        not the trade.
      </p>

      <h2 id="tips">Keep a swap from linking back to you</h2>
      <ul>
        <li>
          <strong>Don&apos;t swap exactly what you deposited.</strong> A swap the
          same size as a recent deposit is easy to match to it. Swap a
          different amount.
        </li>
        <li>
          <strong>Don&apos;t cash out exactly what you received.</strong>{" "}
          A cash
          out of the swap&apos;s exact output can be matched to the swap. Send it
          on, or cash out a different amount.
        </li>
        <li>
          <strong>Mind the crowd.</strong> The mainnet vaults are new, so there
          are few notes to hide among for now.
        </li>
      </ul>

      <h2 id="one-note">One note per swap</h2>
      <p>
        Your private balance can be made of several notes: each deposit,
        payment you claimed, or change from a payment is its own. A swap spends
        exactly one of them.
      </p>
      <p>
        So <strong>Max</strong> is your largest single note, not your whole
        balance. When your balance is in several parts, the app says how much
        one swap can take. Swap the rest in a second swap.
      </p>
      <p>
        Swap less than a note and the app first sets that part aside in a note
        of its own, privately and through the relay. The rest stays in your
        private balance. The app picks the note that matches your amount
        exactly, or else the smallest one that covers it.
      </p>

      <h2 id="costs">What it costs</h2>
      <ul>
        <li>
          <strong>Vault fee, 0.25% of the amount you swap.</strong> A swap takes
          the note out of the vault the same way a cash out does, so the vault
          keeps its usual cash-out fee.
        </li>
        <li>
          <strong>Price buffer, 0.5% on Robinhood Chain and 0.1% on Tempo.</strong>{" "}
          The swap asks for a little less than the quote, so a small price move
          before it lands does not make it fail. Whatever the trade does not use
          goes to the Gloam treasury.
        </li>
        <li>
          <strong>Pool fees</strong> are already in the quoted price.
        </li>
        <li>
          <strong>Network fee:</strong> the relay pays it.
        </li>
      </ul>
      <p>
        Open <strong>Details</strong> under the rate to see each part before
        you swap: what you receive, the vault fee, the price buffer, the route,
        and who sends it.
      </p>
      <p>
        The amount shown is the least you get. The quote refreshes every 15
        seconds, and the app prices the swap once more just before it goes. If
        the price moved your way, you get the better amount. If it moved
        against you by more than the buffer, the swap does not go through and
        nothing moves.
      </p>
      <p>
        Beta deposit limits apply to what lands, because the new note is a
        deposit. One swap brings in at most 500 of a stablecoin, or 25,000
        $GLOAM, and only while the vault has room under its total.
        {V2 &&
          " Every other token has its own limits, and a token the vault does not take yet can't be swapped into. A swap also spends no more than its refund could bring back in one deposit, so a larger part of your balance is split first."}
      </p>

      <h2 id="refund">If a swap can&apos;t finish</h2>
      <p>
        Once a swap is sent, its proofs are public. Anyone can copy its first
        step, the release from the vault, and send it on its own. That makes
        the swap fail on purpose. It cannot send your money anywhere else.
      </p>
      <p>
        Here is why. The escrow address is worked out from everything the swap
        must do: the note spent, your new note, a refund note and the route.
        Only the router can open it, and only to put the money back into the
        vault for you.
      </p>
      <p>
        So the money comes back to your private balance as a refund note, made
        in advance with the swap. You get back 99% of the note. The other 1%
        covers the vault&apos;s cash-out fee (0.25% today), and what is left of
        it goes to the Gloam treasury. The app finishes the refund by itself,
        through the relay, the next time it syncs your balance.
      </p>
      <p>
        If a swap simply doesn&apos;t go through, for example because the price
        moved past the buffer, nothing moved and your money is safe in the
        vault. Refresh in a minute, then get a new quote.
      </p>

      <h2 id="trust">What the router can and cannot do</h2>
      <ul>
        {V2 ? (
          <>
            <li>
              <strong>No upgrade, and nobody moves money.</strong> No one can
              change the routers&apos; code, the vault, the treasury or the
              exchange they use, and no function sends what passes through them
              anywhere but your new note and the treasury.
            </li>
            <li>
              <strong>Allowed venues, changed in public.</strong>{" "}
              On Robinhood Chain the router only uses Uniswap v4 pools on its
              allowlist. Its owner can add a pool only with 3 days of public
              notice on chain, and can take one off at once. A swap names its
              route in advance, so a pool added later can never be slipped into
              it. On Tempo the router only uses Tempo&apos;s stablecoin exchange.
            </li>
            <li>
              <strong>ETH as WETH.</strong> The vault holds WETH. When a route
              uses a pool that holds ETH, the router unwraps or wraps exactly
              what that pool trades, inside the swap, and keeps none of it.
            </li>
            <li>
              <strong>Issuers keep their powers.</strong> Robinhood can pause a
              stock token or block an address, as Paxos can with USDG. A swap in
              or out of a paused token fails and nothing moves; a refund in one
              waits until it can land.
            </li>
          </>
        ) : (
          <>
            <li>
              <strong>No owner, no admin, no upgrade.</strong> The routers have no
              settings anyone can change after deploy.
            </li>
            <li>
              <strong>Fixed venues.</strong>{" "}
              On Robinhood Chain the router only uses
              three Uniswap v4 pools fixed when it was deployed. On Tempo it only
              uses Tempo&apos;s stablecoin exchange.
            </li>
          </>
        )}
        <li>
          <strong>Exact output or nothing.</strong> The router checks that it
          got the full amount of your new note and paid no more than arrived
          from the vault. Otherwise the whole swap reverts.
          {V2 && " So even a pool that turns against a swap can keep at most its price buffer, the part that would go to the treasury, never your new note and never anyone else's money."}
        </li>
        <li>
          <strong>The vault is unchanged.</strong> The mainnet vault still has
          no swap code. The router uses only its normal calls: release a note
          with a proof, and deposit with a proof.
        </li>
        <li>
          <strong>Not audited.</strong> The routers were reviewed internally
          before deploy. An external audit is planned, as for the vault.
        </li>
      </ul>
      <p>
        The full list of risks is in the{" "}
        <Link href="/docs/threat-model#swaps">threat model</Link>.
      </p>

      <h2 id="contracts">Contracts</h2>
      <ul>
        <li>
          <strong>Robinhood Chain router</strong> ({V2 ? "GloamVaultSwapV4b" : "GloamVaultSwapV4"}),{" "}
          <code>{VAULT_SWAP_ROUTERS[4663]}</code>
        </li>
        {V2 && (
          <li>
            <strong>Earlier Robinhood Chain router</strong> (GloamVaultSwapV4),
            which still finishes the refunds of swaps made through it,{" "}
            <code>{RH_V1_ROUTER}</code>
          </li>
        )}
        <li>
          <strong>Tempo router</strong> (GloamVaultSwapTempo),{" "}
          <code>{VAULT_SWAP_ROUTERS[4217]}</code>
        </li>
        <li>
          <strong>Vault</strong>, the same address on both chains,{" "}
          <code>{VAULT}</code>
        </li>
        <li>
          <strong>Treasury</strong>, where unused input goes, fixed in both
          routers, <code>{TREASURY}</code>
        </li>
      </ul>

      <h2 id="sealed-trade">The old sealed trade</h2>
      <p>
        Private swaps replace the first private trade design, the sealed swap.
        That one is retired and stays off. See{" "}
        <Link href="/docs/sealed-trade">sealed trade (retired)</Link>.
      </p>

      <h2 id="try">Try it</h2>
      <p>
        In the app, open <AppLink href="/app/vault?tab=swap">Vault &gt; Swap</AppLink>{" "}
        on a mainnet. Connect a wallet and you can check prices before you
        have a private balance. To swap, first add one of the tokens above in{" "}
        <AppLink href="/app/vault?tab=shield">Add</AppLink>. See also{" "}
        <Link href="/docs/privacy-model">what stays private</Link> and{" "}
        <Link href="/docs/chain#mainnet">networks</Link>.
      </p>
    </DocsLayout>
  );
}
