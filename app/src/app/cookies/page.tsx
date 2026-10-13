import type { Metadata } from "next";
import { CookiePreferences } from "@/components/CookiePreferences";
import { LegalLayout } from "@/components/LegalLayout";

export const metadata: Metadata = { title: "Cookie Policy" };

export default function CookiesPage() {
  return (
    <LegalLayout title="Cookie Policy" updated="October 13, 2026">
      <p>
        This Cookie Policy explains what Gloam keeps on your device and which
        usage counts it collects on gloam.trade. Gloam runs on testnets only,
        with play money.
      </p>
      <p>
        The short version: we set no advertising or tracking cookies. The only
        cookies we set are sign-in cookies, and only when you sign in. Usage
        counts are anonymous, use no cookies, and run only if you choose
        &ldquo;Accept all&rdquo;, except four claim-link totals that hold
        nothing about who you are (described below).
      </p>
      <h2>Your preferences</h2>
      <CookiePreferences />
      <h2>What are cookies?</h2>
      <p>
        Cookies are small text files a site stores in your browser. Local
        storage and IndexedDB are similar places in your browser where a site
        can keep data. Data in all three stays on your device unless the site
        sends it somewhere.
      </p>
      <h2>What runs with &ldquo;Essential only&rdquo;</h2>
      <p>
        <strong>Sign-in cookies.</strong> <code>gloam_partner</code> keeps you
        signed in to the partner portal for up to 7 days.{" "}
        <code>gloam_admin</code>{" "}does the same for the Gloam team&apos;s admin
        page. Neither is set unless you sign in. These are the only cookies
        Gloam sets.
      </p>
      <p>
        <strong>Local storage.</strong>{" "}The site and app keep these in your
        browser: your choice on this page (<code>gloam_cookie_consent</code>),
        your theme, the network you picked, which wallet you connected, app
        settings and tips you dismissed, and a cache of public chain data. The
        app also keeps what your private balance needs: your notes and their
        secrets, your receive keys, your payroll lists and the contacts you
        save. Notes and payroll lists are encrypted. None of this is sent to us,
        except an encrypted recovery backup if you turn recovery on.
      </p>
      <p>
        <strong>Claim-link totals.</strong>{" "}With &ldquo;Essential
        only&rdquo;, or before you choose, the only thing counted is four daily
        totals that show whether payment links reach people: a claim link was
        made, opened, or claimed, and someone who claimed one made their own
        first payment. Each count is just &ldquo;add 1 to today&rdquo;: no
        cookie, no ID, no IP address kept, and nothing about the link, the
        amount, the people involved or your wallet. Your browser keeps a short
        local note of the links it already counted (in local storage), so the
        same one is not counted twice.
      </p>
      <p>
        Nothing else is counted with &ldquo;Essential only&rdquo;, or before you
        choose.
      </p>
      <h2>What &ldquo;Accept all&rdquo; adds</h2>
      <p>
        <strong>Anonymous usage counts, with no cookies.</strong>{" "}Three kinds,
        all off until you choose &ldquo;Accept all&rdquo;:
      </p>
      <ul>
        <li>
          <strong>Vercel Web Analytics</strong>, from our hosting provider,
          counts page views. It sets no cookies. Vercel says it tells visits
          apart with a hash of the request that it discards after 24 hours, and
          records the page, the site that sent you, your rough location
          (country, region, city), and your browser, operating system and device
          type. We cut the page link at the first &ldquo;?&rdquo; or
          &ldquo;#&rdquo; before it is sent, so the details in a payment request
          or proof link never reach Vercel.
        </li>
        <li>
          <strong>Gloam product counts.</strong>{" "}When you reach a step in the
          app, such as connecting a wallet, finishing a deposit, sending
          privately, making a proof or applying to test, your browser sends a
          short event to us. It holds the event name, the page, the site that
          sent you, the time, your browser&apos;s user agent, and a few safe
          details such as the network or the kind of proof. Our server drops
          anything that could be an amount, an address, a name, a note or a
          proof, even if a browser sends it. No cookie or ID is used, and your
          IP address is not kept with the event.
        </li>
        <li>
          <strong>Visits.</strong>{" "}A visit event when you load the site (the
          page you land on and the site that sent you), and which network you
          view on the Transparency page, with the same fields as the product
          counts.
        </li>
      </ul>
      <p>
        We use these counts to see which parts of Gloam work and where people
        get stuck. The full details, including how long we keep them, are in
        the{" "}
        <a href="/privacy">
          Privacy Policy
        </a>
        .
      </p>
      <h2>Changing your choice</h2>
      <p>
        Use the buttons at the top of this page at any time. Clearing this
        site&apos;s data in your browser also resets your choice and brings
        the banner back. It deletes the private balance kept in that browser
        too, so turn on recovery or back up your notes first. Your browser
        settings can block cookies, but the partner portal needs its cookie to
        keep you signed in.
      </p>
      <h2>Updates</h2>
      <p>
        We may revise this Policy as the product changes. The &ldquo;Last
        updated&rdquo; date will change when we do.
      </p>
      <h2>More information</h2>
      <p>
        See our{" "}
        <a href="/privacy">
          Privacy Policy
        </a>
        .
      </p>
    </LegalLayout>
  );
}
