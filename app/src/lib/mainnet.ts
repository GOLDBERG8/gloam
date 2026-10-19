/**
 * Mainnet launch time, shared by the countdown page, the site banner, the
 * homepage link and Glim. Wednesday 21 October 2026, 13:00 UTC (14:00 WAT).
 */
export const MAINNET_LAUNCH_ISO = "2026-10-21T13:00:00Z";
export const MAINNET_LAUNCH_MS = Date.parse(MAINNET_LAUNCH_ISO);

/** How the launch time is written everywhere: in UTC. */
export const MAINNET_LAUNCH_LABEL = "Wednesday 21 October, 13:00 UTC";
export const MAINNET_LAUNCH_SHORT = "Wed 21 Oct, 13:00 UTC";

export const MAINNET_PAGE = "/mainnet";

export type Remaining = { days: number; hours: number; minutes: number; seconds: number; done: boolean };

export function remainingUntil(now: number, target = MAINNET_LAUNCH_MS): Remaining {
  const left = Math.max(0, Math.floor((target - now) / 1000));
  return {
    days: Math.floor(left / 86_400),
    hours: Math.floor((left % 86_400) / 3_600),
    minutes: Math.floor((left % 3_600) / 60),
    seconds: left % 60,
    done: left === 0,
  };
}

/** "1d 12h 5m", "3h 20m", "4m 10s": short enough for a banner. */
export function compactRemaining(r: Remaining): string {
  if (r.days > 0) return `${r.days}d ${r.hours}h ${r.minutes}m`;
  if (r.hours > 0) return `${r.hours}h ${r.minutes}m`;
  return `${r.minutes}m ${r.seconds}s`;
}

/** A Google Calendar link for the launch (one hour, in UTC). */
export function calendarUrl(): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: "Gloam mainnet goes live",
    dates: `${stamp(MAINNET_LAUNCH_MS)}/${stamp(MAINNET_LAUNCH_MS + 3_600_000)}`,
    details: "Private payments go live on Robinhood Chain and Tempo mainnet. https://gloam.trade/mainnet",
    location: "https://gloam.trade/mainnet",
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
