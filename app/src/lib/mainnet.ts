/**
 * Mainnet: the two pools, the launch time, and whether mainnet is live.
 *
 * MAINNET_POOLS is FILLED IN ON DEPLOY DAY: paste each pool address and the
 * block its deploy transaction landed in (the deploy script prints both). Until
 * a chain has both, that mainnet is hidden everywhere: the app, the API, the
 * relay, the MCP server, Glim and proofs all act as if it does not exist.
 *
 * The block number can be written plain (12345678) or as a bigint (12345678n).
 */
export const MAINNET_POOLS: Record<MainnetChainId, MainnetPoolInput> = {
  // Robinhood Chain mainnet (4663): USDG + GLOAM
  4663: { pool: null, deployBlock: null },
  // Tempo mainnet (4217): USDC.e, pathUSD, USDT0, OUSD
  4217: { pool: null, deployBlock: null },
};

export type MainnetChainId = 4663 | 4217;

type MainnetPoolInput = { pool: string | null; deployBlock: number | bigint | null };

export type MainnetPool = { pool: `0x${string}`; deployBlock: bigint };

/**
 * A chain's mainnet pool, or null while it is not filled in. A pool address
 * that is not an address fails the build instead of quietly hiding the chain.
 */
export function mainnetPool(chainId: MainnetChainId): MainnetPool | null {
  const { pool, deployBlock } = MAINNET_POOLS[chainId];
  if (pool === null || deployBlock === null) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(pool) || /^0x0{40}$/.test(pool)) {
    throw new Error(`MAINNET_POOLS[${chainId}].pool is not a pool address: ${pool}`);
  }
  const block = BigInt(deployBlock);
  if (block <= 0n) throw new Error(`MAINNET_POOLS[${chainId}].deployBlock must be the deploy block, got ${deployBlock}`);
  return { pool: pool as `0x${string}`, deployBlock: block };
}

/** At least one mainnet pool is filled in. */
export const MAINNET_CONFIGURED = mainnetPool(4663) !== null || mainnetPool(4217) !== null;

/**
 * Mainnet is live once the launch time has passed and at least one pool is in.
 * Before that every page, banner and Glim answer counts down exactly as before.
 */
export function isMainnetLive(now: number = Date.now()): boolean {
  return MAINNET_CONFIGURED && now >= MAINNET_LAUNCH_MS;
}

/**
 * Launch time, shared by the countdown page, the site banner, the homepage
 * link and Glim. Wednesday 21 October 2026, 13:00 UTC (14:00 WAT).
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
