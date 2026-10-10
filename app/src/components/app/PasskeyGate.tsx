"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mark } from "@/components/Logo";
import { startOverWithoutPasskey } from "@/lib/noteVault";
import { PasskeyError, unlockWithPasskey, useVaultStatus } from "@/lib/passkey";

/**
 * Shown over the app while a passkey-protected vault is locked (each time the
 * app opens). Nothing private loads until the passkey unlocks it. Never shown
 * in the recording demo, or when no passkey is set.
 */
export function PasskeyGate() {
  const { locked } = useVaultStatus();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lost, setLost] = useState<"closed" | "open" | "confirm">("closed");
  const unlockRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!locked) return;
    document.body.style.overflow = "hidden";
    unlockRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
    };
  }, [locked]);

  if (!locked) return null;

  async function unlock() {
    setBusy(true);
    setMsg(null);
    try {
      await unlockWithPasskey();
      // Views re-read notes on focus; nudge them in case this tab was locked
      // after it had already loaded.
      window.dispatchEvent(new Event("focus"));
    } catch (e) {
      setMsg(e instanceof PasskeyError ? e.message : "Could not unlock. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function startOver() {
    setBusy(true);
    try {
      await startOverWithoutPasskey();
      window.location.assign("/app/settings#backup");
    } catch {
      setMsg("Could not start over. Nothing changed.");
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-background/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="passkey-gate-title"
    >
      <div className="w-full max-w-[420px] rounded-[24px] border border-line bg-panel p-7 shadow-pop">
        <Mark size={32} />
        <p className="t-label mt-6">Passkey lock</p>
        <h2 id="passkey-gate-title" className="t-display-m mt-2 text-foreground">
          Unlock your private balance
        </h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-mute">
          Your balance on this browser is locked with a passkey. Use Face ID,
          Touch ID, or your security key to open it.
        </p>

        <button
          ref={unlockRef}
          type="button"
          onClick={unlock}
          disabled={busy}
          className="btn btn-ink btn-lg btn-block mt-6"
        >
          {busy && lost === "closed" ? "Waiting for your passkey…" : "Unlock"}
        </button>

        {msg && (
          <p role="alert" className="mt-4 rounded-xl bg-surface px-4 py-3 text-[13.5px] leading-relaxed text-soft">
            {msg}
          </p>
        )}

        <div className="mt-6 border-t border-line pt-4">
          {lost === "closed" ? (
            <button
              type="button"
              onClick={() => setLost("open")}
              className="text-[13.5px] text-mute underline-offset-4 hover:text-foreground hover:underline"
            >
              Lost your passkey?
            </button>
          ) : (
            <div className="text-[13.5px] leading-relaxed text-mute">
              <p>
                Without it, this browser can&apos;t open the balance saved here.
                If you have a backup, start over and restore it in Settings. The
                locked copy is set aside on this browser, not deleted.
              </p>
              {lost === "open" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setLost("confirm")} className="btn btn-ghost btn-sm h-10">
                    Start over
                  </button>
                  <button type="button" onClick={() => setLost("closed")} className="btn btn-quiet btn-sm h-10 text-mute">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="mt-3 rounded-[14px] bg-warn-soft px-4 py-3 text-warn">
                  <p>Only a backup brings your balance and your Gloam address back after this. Start over?</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={startOver} className="btn btn-ink btn-sm h-10">
                      Yes, start over
                    </button>
                    <button type="button" onClick={() => setLost("open")} className="btn btn-quiet btn-sm h-10">
                      Go back
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <Link
            href="/docs/privacy-model#security"
            className="mt-3 block text-[12.5px] text-faint hover:text-foreground"
          >
            How the passkey lock works
          </Link>
        </div>
      </div>
    </div>,
    document.body
  );
}
