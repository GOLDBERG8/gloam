"use client";

import Link from "next/link";
import { AppLink } from "@/components/AppLink";
import { useState, type FormEvent, type ReactNode } from "react";
import { track } from "@/lib/track";

type Network = "both" | "tempo" | "robinhood";
type Field = "name" | "telegram" | "x" | "address" | "network" | "setup" | "note";

const NETWORKS: { k: Network; label: string }[] = [
  { k: "both", label: "Both" },
  { k: "tempo", label: "Tempo" },
  { k: "robinhood", label: "Robinhood Chain" },
];

type Done = { duplicate: boolean; paid: boolean; group: string | null };

export function TestersForm({ paidFull, paidSpots }: { paidFull: boolean; paidSpots: number }) {
  const [network, setNetwork] = useState<Network>("both");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ field: Field | null; message: string } | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get("name"),
      telegram: f.get("telegram"),
      x: f.get("x"),
      address: f.get("address"),
      network,
      setup: f.get("setup"),
      note: f.get("note"),
      hp: f.get("hp"),
    };
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/testers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: Done }
        | { ok: false; error: { field: Field | null; message: string } }
        | null;
      if (json?.ok) {
        track("testers_submit", { network, paid: json.data.paid, duplicate: json.data.duplicate });
        setDone(json.data);
      } else {
        const err = json?.error ?? { field: null, message: "We couldn't send that. Try again in a moment." };
        setError(err);
        if (err.field) document.getElementById(`t-${err.field}`)?.focus();
      }
    } catch {
      setError({ field: null, message: "No connection. Check your internet and try again." });
    } finally {
      setSending(false);
    }
  }

  if (done) return <Success done={done} />;

  const fieldError = (k: Field) => (error?.field === k ? error.message : null);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {paidFull && (
        <div className="rounded-xl bg-sealed-soft px-4 py-3.5 text-[14px] leading-relaxed text-foreground">
          <p className="font-medium">Paid testing is full.</p>
          <p className="mt-1 text-soft">
            Our first {paidSpots} testers are recorded and will be rewarded. If you apply now, you join as a volunteer tester:
            same group and early access, without the reward.
          </p>
        </div>
      )}

      <Row label="Name" htmlFor="t-name" error={fieldError("name")}>
        <input
          id="t-name"
          name="name"
          required
          autoComplete="name"
          maxLength={80}
          className="gl-input"
          aria-invalid={Boolean(fieldError("name"))}
          aria-describedby={fieldError("name") ? "t-name-err" : undefined}
        />
      </Row>

      <div className="grid gap-5 sm:grid-cols-2">
        <Row label="Telegram username" htmlFor="t-telegram" error={fieldError("telegram")}>
          <input
            id="t-telegram"
            name="telegram"
            required
            placeholder="@yourname"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={64}
            className="gl-input"
            aria-invalid={Boolean(fieldError("telegram"))}
            aria-describedby={fieldError("telegram") ? "t-telegram-err" : undefined}
          />
        </Row>
        <Row label="X handle" optional htmlFor="t-x" error={fieldError("x")}>
          <input
            id="t-x"
            name="x"
            placeholder="@yourhandle"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={64}
            className="gl-input"
            aria-invalid={Boolean(fieldError("x"))}
            aria-describedby={fieldError("x") ? "t-x-err" : undefined}
          />
        </Row>
      </div>

      <Row
        label="EVM address"
        htmlFor="t-address"
        hint={paidFull ? "We use it to match you to your testing on chain." : "Tester rewards are paid to this address."}
        error={fieldError("address")}
      >
        <input
          id="t-address"
          name="address"
          required
          placeholder="0x…"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={64}
          className="gl-input tnum"
          aria-invalid={Boolean(fieldError("address"))}
          aria-describedby={fieldError("address") ? "t-address-err" : "t-address-hint"}
        />
      </Row>

      <fieldset>
        <legend className="text-[13.5px] text-foreground">Where you want to test</legend>
        <div role="radiogroup" aria-label="Network" className="mt-2 inline-flex flex-wrap rounded-full bg-surface p-1 text-[13.5px]">
          {NETWORKS.map((n) => (
            <button
              key={n.k}
              type="button"
              role="radio"
              aria-checked={network === n.k}
              onClick={() => setNetwork(n.k)}
              className={`h-9 rounded-full px-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
                network === n.k ? "bg-panel text-foreground shadow-card" : "text-mute hover:text-foreground"
              }`}
            >
              {n.label}
            </button>
          ))}
        </div>
      </fieldset>

      <Row label="Device and wallet" optional htmlFor="t-setup" error={fieldError("setup")}>
        <input id="t-setup" name="setup" placeholder="iPhone, MetaMask" autoComplete="off" maxLength={120} className="gl-input" />
      </Row>

      <Row label="What would you use private payments for?" optional htmlFor="t-note" error={fieldError("note")}>
        <textarea
          id="t-note"
          name="note"
          rows={3}
          maxLength={400}
          className="gl-input h-auto resize-y py-3 leading-relaxed"
        />
      </Row>

      {/* people never see this field; bots fill it */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="t-hp">Leave this empty</label>
        <input id="t-hp" name="hp" tabIndex={-1} autoComplete="off" />
      </div>

      {error && !error.field && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
          {error.message}
        </p>
      )}

      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <button type="submit" disabled={sending} className="btn btn-ink btn-lg">
          {sending ? "Sending…" : paidFull ? "Join as a volunteer" : "Apply to test"}
        </button>
        <p className="text-[12.5px] leading-relaxed text-mute sm:max-w-[30ch] sm:text-right">
          We never ask for a recovery phrase or private key.
        </p>
      </div>

      <p className="text-[12.5px] leading-relaxed text-mute">
        By applying you agree to our{" "}
        <Link href="/terms" className="text-foreground underline underline-offset-2">
          Terms of Use
        </Link>
        . Our{" "}
        <Link href="/privacy" className="text-foreground underline underline-offset-2">
          Privacy Policy
        </Link>{" "}
        and{" "}
        <Link href="/cookies" className="text-foreground underline underline-offset-2">
          Cookie Policy
        </Link>{" "}
        explain what we keep and for how long.
      </p>
    </form>
  );
}

function Row({
  label,
  htmlFor,
  optional,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  hint?: string;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-3 text-[13.5px] text-foreground">
        {label}
        {optional && <span className="text-[12.5px] text-faint">Optional</span>}
      </label>
      <div className="mt-2">{children}</div>
      {error ? (
        <p id={`${htmlFor}-err`} className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-2 text-[13px] text-mute">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Success({ done }: { done: Done }) {
  return (
    <div role="status" className="flex flex-col items-start">
      <span aria-hidden className="grid h-11 w-11 place-items-center rounded-full bg-sealed-soft text-sealed">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h2 className="mt-5 text-[24px] font-light tracking-[-0.02em] text-foreground">
        {done.duplicate ? "You've already applied." : done.paid ? "You're on the list." : "You're in as a volunteer tester."}
      </h2>
      {!done.duplicate && (
        <p className="mt-1 text-[14px] text-mute">
          {done.paid ? "You have one of the paid tester spots." : "Paid spots were full, so this round is unpaid for you."}
        </p>
      )}
      {done.group ? (
        <>
          <p className="mt-2 max-w-[42ch] text-[15px] leading-relaxed text-soft">
            Ask to join the private testers group from the Telegram account you gave us, and we&rsquo;ll let you in.
          </p>
          <a href={done.group} target="_blank" rel="noreferrer" className="btn btn-ink btn-lg mt-6">
            Join the testers group
          </a>
        </>
      ) : (
        <p className="mt-2 max-w-[42ch] text-[15px] leading-relaxed text-soft">
          We&rsquo;ll send your invite to the private testers group on Telegram soon.
        </p>
      )}
      <AppLink href="/app" className="mt-5 text-[14px] text-mute underline decoration-line-strong underline-offset-4 hover:text-foreground">
        Open the app while you wait
      </AppLink>
    </div>
  );
}
