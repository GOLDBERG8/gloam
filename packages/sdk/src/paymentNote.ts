/**
 * The private note on a payment, like "Invoice 042" or an agent ID.
 *
 * It rides inside the payment itself (the gloam1. note package, sealed to the
 * payee as gloam2t.), so only the payee ever reads it. It is never posted in
 * the open and never goes into a proof. Same rules as the Gloam app
 * (app/src/lib/paymentNote.ts): cleaned of control and direction-override
 * characters, spaces squeezed, at most 80 characters. Request links clean their
 * note the same way, so a note asked for in a request arrives exactly as asked.
 */

export const PAYMENT_NOTE_MAX = 80;

/** Drops control and direction-override characters, squeezes spaces, caps length. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== "string" || !raw) return "";
  return Array.from(
    raw
      .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  )
    .slice(0, max)
    .join("")
    .trim();
}

/** A payment note as it is sent and stored: cleaned, at most 80 characters. */
export function cleanPaymentNote(raw: unknown): string {
  return cleanText(raw, PAYMENT_NOTE_MAX);
}
