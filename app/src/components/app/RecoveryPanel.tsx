"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSignMessage } from "wagmi";
import { useAppAccount } from "@/lib/demo";
import { WALLET_BROWSER_NOTE, inWalletBrowser, passkeySupport } from "@/lib/passkey";
import {
  RECOVERY_MESSAGE,
  RecoveryError,
  backupNow,
  connectRecovery,
  keysFromSecret,
  passkeySecret,
  recoveryServerState,
  recoveryState,
  startRecoverySync,
  subscribeRecovery,
  turnOffRecovery,
  walletSecret,
  type RecoverySource,
} from "@/lib/recovery";
import { isTempoWallet } from "@/lib/tempoWallet";

type Busy = "on-wallet" | "on-passkey" | "restore-wallet" | "restore-passkey" | "save" | "off" | null;
type Message = { tone: "ok" | "error"; text: string } | null;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function errorText(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? "";
  const text = e instanceof Error ? e.message : "";
  if (name === "UserRejectedRequestError" || /reject|denied|cancel/i.test(text)) {
    return "Signing was cancelled. Nothing changed.";
  }
  return e instanceof RecoveryError ? e.message : "Something went wrong. Nothing changed. Try again.";
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function ago(ts: number | null): string {
  if (!ts) return "not backed up yet";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "backed up just now";
  if (s < 3600) return `backed up ${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `backed up ${Math.round(s / 3600)} h ago`;
  return `backed up ${new Date(ts).toLocaleDateString()}`;
}

/** Shared state and actions for the settings card and the portfolio nudge. */
function useRecovery() {
  const state = useSyncExternalStore(subscribeRecovery, recoveryState, recoveryServerState);
  const { address, isConnected, connector, demo } = useAppAccount();
  const { signMessageAsync } = useSignMessage();
  const [passkeyOk, setPasskeyOk] = useState(false);
  const [walletBrowser, setWalletBrowser] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    startRecoverySync();
    let live = true;
    void passkeySupport().then((s) => {
      if (!live) return;
      setPasskeyOk(s !== "no");
      setWalletBrowser(inWalletBrowser());
    });
    return () => {
      live = false;
    };
  }, []);

  const active = isConnected && !demo;
  // Tempo Wallet signs with a passkey, differently every time: it can't hold a key.
  const walletOk = active && !isTempoWallet(connector);

  async function walletKeys(confirm: boolean) {
    const first = walletSecret(await signMessageAsync({ message: RECOVERY_MESSAGE }));
    if (!first) throw new RecoveryError("This wallet can't create a recovery key. Use a passkey instead.", "unsupported");
    if (confirm) {
      const second = walletSecret(await signMessageAsync({ message: RECOVERY_MESSAGE }));
      if (!second || !sameBytes(first, second)) {
        throw new RecoveryError(
          "Your wallet signs differently each time, so it can't hold a recovery key. Use a passkey instead.",
          "unsupported",
        );
      }
    }
    return keysFromSecret("wallet", first);
  }

  async function run(kind: Exclude<Busy, null>, task: () => Promise<string>) {
    if (busy) return;
    setBusy(kind);
    setMessage(null);
    try {
      setMessage({ tone: "ok", text: await task() });
    } catch (e) {
      setMessage({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  const turnOn = (source: RecoverySource) =>
    run(source === "wallet" ? "on-wallet" : "on-passkey", async () => {
      const keys = source === "wallet" ? await walletKeys(true) : await keysFromSecret("passkey", await passkeySecret("create"));
      const added = await connectRecovery(keys, address);
      return added
        ? `Recovery is on. ${plural(added, "balance")} came back from your backup.`
        : "Recovery is on. Your private balance is backed up.";
    });

  const restore = (source: RecoverySource) =>
    run(source === "wallet" ? "restore-wallet" : "restore-passkey", async () => {
      const keys = source === "wallet" ? await walletKeys(false) : await keysFromSecret("passkey", await passkeySecret("use"));
      const added = await connectRecovery(keys, address, { mustExist: true });
      return added
        ? `Restored ${plural(added, "balance")}. Recovery is on for this browser too.`
        : "Your backup is connected. This browser already had everything in it.";
    });

  const save = () =>
    run("save", async () => {
      await backupNow();
      return "Backed up.";
    });

  const off = () =>
    run("off", async () => {
      await turnOffRecovery({ deleteBackup: true });
      return "Recovery is off and the backup is deleted. Your balance stays in this browser.";
    });

  return { state, active, walletOk, passkeyOk, walletBrowser, busy, message, turnOn, restore, save, off };
}

function Note({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 text-[13px] leading-relaxed ${message.tone === "error" ? "text-danger" : "text-sealed"}`}>
      {message.text}
    </p>
  );
}

function Choice({
  label,
  hint,
  children,
}: {
  label: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
      <div className="min-w-0 max-w-[52ch]">
        <p className="text-[14px] text-foreground">{label}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-mute">{hint}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Settings: turn recovery on, restore from it, or turn it off. */
export function RecoverySettingsCard() {
  const r = useRecovery();
  const [confirmOff, setConfirmOff] = useState(false);
  const { state, busy } = r;

  return (
    <section id="recovery" className="gl-card scroll-mt-24">
      <header className="max-sm:px-5 max-sm:pt-5 sm:px-6 sm:pt-6">
        <h2 className="text-[17px] text-foreground">Recovery</h2>
        <p className="mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-mute">
          Get your private balance back on any device, just by signing in. Gloam keeps an encrypted copy that only your
          wallet or passkey can open. We can&apos;t read it.
        </p>
      </header>
      <div className="mt-2 divide-y divide-line pb-1 max-sm:px-5 max-sm:pb-4 sm:px-6 sm:pb-5">
        {!r.active ? (
          <Choice label="Recovery" hint="Connect a wallet to set up recovery.">
            {null}
          </Choice>
        ) : state.on ? (
          <div className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[14px] text-foreground">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sealed" />
                  Recovery is on
                </p>
                <p className="mt-0.5 text-[13px] text-mute">
                  {state.source === "passkey" ? "With a passkey" : "With your wallet"} · {state.busy ? "backing up…" : ago(state.savedAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={r.save} disabled={Boolean(busy) || state.busy} className="btn btn-ghost btn-sm">
                  {busy === "save" ? "Backing up…" : "Back up now"}
                </button>
                {!confirmOff ? (
                  <button type="button" onClick={() => setConfirmOff(true)} disabled={Boolean(busy)} className="btn btn-ghost btn-sm">
                    Turn off
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmOff(false);
                        r.off();
                      }}
                      disabled={Boolean(busy)}
                      className="btn btn-ink btn-sm"
                    >
                      {busy === "off" ? "Turning off…" : "Turn off and delete backup"}
                    </button>
                    <button type="button" onClick={() => setConfirmOff(false)} className="btn btn-ghost btn-sm">
                      Keep it on
                    </button>
                  </>
                )}
              </div>
            </div>
            {state.error && <p className="mt-3 text-[13px] text-danger">{state.error}</p>}
            <Note message={r.message} />
          </div>
        ) : (
          <>
            <Choice
              label="Turn on recovery"
              hint={
                r.walletOk
                  ? "Your wallet asks you to sign twice. It's free and sends nothing."
                  : "Tempo Wallet can't sign a recovery key, so use a passkey."
              }
            >
              {r.walletOk && (
                <button type="button" onClick={() => r.turnOn("wallet")} disabled={Boolean(busy)} className="btn btn-ink btn-sm">
                  {busy === "on-wallet" ? "Check your wallet…" : "With your wallet"}
                </button>
              )}
              {r.passkeyOk && (
                <button
                  type="button"
                  onClick={() => r.turnOn("passkey")}
                  disabled={Boolean(busy)}
                  className={r.walletOk ? "btn btn-ghost btn-sm" : "btn btn-ink btn-sm"}
                >
                  {busy === "on-passkey" ? "Check your passkey…" : "With a passkey"}
                </button>
              )}
            </Choice>
            <Choice label="Restore from your backup" hint="On a new device? Sign in the same way you did when you turned recovery on.">
              {r.walletOk && (
                <button type="button" onClick={() => r.restore("wallet")} disabled={Boolean(busy)} className="btn btn-ghost btn-sm">
                  {busy === "restore-wallet" ? "Check your wallet…" : "With your wallet"}
                </button>
              )}
              {r.passkeyOk && (
                <button type="button" onClick={() => r.restore("passkey")} disabled={Boolean(busy)} className="btn btn-ghost btn-sm">
                  {busy === "restore-passkey" ? "Check your passkey…" : "With a passkey"}
                </button>
              )}
            </Choice>
            {r.walletBrowser && !r.passkeyOk && (
              <p className="py-2 text-[12px] leading-relaxed text-mute">{WALLET_BROWSER_NOTE}</p>
            )}
            {r.message && (
              <div className="py-3">
                <Note message={r.message} />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const NUDGE_KEY = "gloam.recovery.nudge.v1";
const NUDGE_SNOOZE_MS = 7 * 86_400_000;

const nudgeListeners = new Set<() => void>();

function subscribeNudge(fn: () => void): () => void {
  nudgeListeners.add(fn);
  return () => {
    nudgeListeners.delete(fn);
  };
}

/** "hidden" while snoozed (or before the browser can say), else "shown". */
function nudgeSnapshot(): "hidden" | "shown" {
  try {
    return Date.now() - Number(localStorage.getItem(NUDGE_KEY) ?? 0) < NUDGE_SNOOZE_MS ? "hidden" : "shown";
  } catch {
    return "shown";
  }
}

const nudgeServerSnapshot = () => "hidden" as const;

function snoozeNudge() {
  try {
    localStorage.setItem(NUDGE_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
  for (const fn of nudgeListeners) fn();
}

/**
 * Portfolio: asks people with a private balance to turn recovery on, and
 * offers a restore to people whose wallet made deposits this browser can't see.
 */
export function RecoveryNudge({ hasBalance, hasDeposits }: { hasBalance: boolean; hasDeposits: boolean }) {
  const r = useRecovery();
  const hidden = useSyncExternalStore(subscribeNudge, nudgeSnapshot, nudgeServerSnapshot) === "hidden";

  const restoreMode = !hasBalance && hasDeposits;
  const done = r.message?.tone === "ok";
  if (!r.active || !r.state.ready || (r.state.on && !done) || hidden || (!hasBalance && !hasDeposits)) return null;

  const source: RecoverySource | null = r.walletOk ? "wallet" : r.passkeyOk ? "passkey" : null;
  const busy = Boolean(r.busy);
  const action = restoreMode ? r.restore : r.turnOn;
  const label = restoreMode
    ? source === "wallet"
      ? "Restore with your wallet"
      : "Restore with a passkey"
    : source === "wallet"
      ? "Turn on with your wallet"
      : "Turn on with a passkey";

  return (
    <section aria-labelledby="recovery-nudge-title" className="gl-card flex gap-4 max-sm:items-start max-sm:p-5 sm:items-center sm:py-4 sm:pl-6 sm:pr-4">
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sealed-soft text-sealed">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="flex min-w-0 flex-1 max-sm:flex-col max-sm:gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h2 id="recovery-nudge-title" className="text-[15px] text-foreground">
            {restoreMode ? "Restore your private balance" : "Don't lose your private balance"}
          </h2>
          {done ? (
            <p className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-sealed" role="status">
              {r.message?.text}
            </p>
          ) : (
            <p className="mt-0.5 max-w-[62ch] text-[13px] leading-relaxed text-mute">
              {restoreMode
                ? "This wallet made deposits this browser can't see. Sign in to bring them back from your backup."
                : "Turn on recovery and you can get it back on any device by signing in."}
              {r.message?.tone === "error" && <span className="mt-1 block text-danger">{r.message.text}</span>}
            </p>
          )}
        </div>
        {!done && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:self-start">
            {source ? (
              <button type="button" onClick={() => action(source)} disabled={busy} className="btn btn-ink btn-sm">
                {busy ? (source === "wallet" ? "Check your wallet…" : "Check your passkey…") : label}
              </button>
            ) : null}
            <Link href={restoreMode ? "/app/settings#backup" : "/app/settings#recovery"} className="btn btn-ghost btn-sm">
              {restoreMode ? "Use a backup file" : "Other ways"}
            </Link>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={snoozeNudge}
        aria-label="Hide for a week"
        title="Hide for a week"
        className="-mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-mute transition-colors hover:bg-surface hover:text-foreground max-sm:-mt-1.5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
    </section>
  );
}
