/**
 * Points the Telegram bot at the Gloam webhook, then prints what Telegram has.
 * Run once after deploying, and again if the token or secret changes.
 *
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node app/scripts/telegram-webhook.mjs
 *
 * The secret must match TELEGRAM_WEBHOOK_SECRET on Vercel. Optional
 * TELEGRAM_WEBHOOK_URL overrides the URL (a preview deployment, say).
 * Pending updates are dropped, so the bot does not answer a backlog.
 */
const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const url = process.env.TELEGRAM_WEBHOOK_URL?.trim() || "https://www.gloam.trade/api/telegram";

if (!token || !secret) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET first.");
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  console.error("TELEGRAM_WEBHOOK_SECRET may use only A-Z, a-z, 0-9, _ and -, up to 256 characters.");
  process.exit(1);
}

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  if (!json?.ok) throw new Error(`${method}: ${json?.description ?? res.status}`);
  return json.result;
}

await call("setWebhook", {
  url,
  secret_token: secret,
  // "message" carries chat messages and join notices; "chat_member" catches joins
  // Telegram does not announce in large groups (needs the bot to be an admin)
  allowed_updates: ["message", "edited_message", "chat_member"],
  drop_pending_updates: true,
});
console.log(`Webhook set to ${url}`);

const info = await call("getWebhookInfo");
console.log(
  JSON.stringify(
    {
      url: info.url,
      pending_update_count: info.pending_update_count,
      allowed_updates: info.allowed_updates,
      last_error_date: info.last_error_date ?? null,
      last_error_message: info.last_error_message ?? null,
    },
    null,
    2,
  ),
);
