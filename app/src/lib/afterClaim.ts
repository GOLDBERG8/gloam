/**
 * The step after a claim (components/app/AfterClaimNext). The first claim
 * secured in this browser shows "What you can do now" in full; every later
 * one gets a single line, so it never nags. Whether this browser has seen it
 * is kept in local storage only, never sent anywhere. A recording demo keeps
 * it in memory instead, so each fresh demo tab starts as a first-timer.
 */
import { readDemo } from "./demoFlag";
import { isSwapAsset, swapOpenTo, vaultSwapRouter } from "./vaultSwap";

const KEY = "gloam.afterClaim.v1";

let demoSeen = false;

/**
 * True for the first claim secured in this browser, and marks it, so the
 * next claim gets the compact line. Blocked storage counts as a first claim.
 */
export function takeFirstClaim(): boolean {
  if (typeof window === "undefined") return false;
  if (readDemo()) {
    const first = !demoSeen;
    demoSeen = true;
    return first;
  }
  try {
    if (window.localStorage.getItem(KEY)) return false;
    window.localStorage.setItem(KEY, "1");
    return true;
  } catch {
    return true;
  }
}

/**
 * Whether Swap is worth offering for what was just claimed: the network has a
 * swap router, the Swap tab is open to this wallet (the same rule VaultHub
 * uses), and the claimed token is one a swap can start from.
 */
export function canSwapAfterClaim(chainId: number, asset: string, address: string | undefined): boolean {
  return vaultSwapRouter(chainId) !== null && swapOpenTo(address) && isSwapAsset(chainId, asset);
}
