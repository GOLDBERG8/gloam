/**
 * The RPC the server uses for a chain. Server reads and relay sends all leave
 * from Vercel's shared IPs, so under load a chain's public RPC starts answering
 * 429. Set GLOAM_RPC_URL_<chainId> (server env only, never NEXT_PUBLIC_) to a
 * private endpoint and the server uses it first, with the public RPC behind it.
 * Without it, the public RPC alone, as before.
 */
import { fallback, http, type HttpTransportConfig, type Transport } from "viem";
import type { GloamNetwork } from "./networks";

type Net = Pick<GloamNetwork, "chainId" | "chain">;

/** The calls that put a signed transaction out. */
const SEND_METHODS = ["eth_sendRawTransaction", "eth_sendRawTransactionSync"];

function privateRpc(net: Net): string | null {
  return process.env[`GLOAM_RPC_URL_${net.chainId}`]?.trim() || null;
}

/**
 * `sendOnce` is for the relay's sends: a signed transaction goes to one RPC
 * only. The public backup still answers reads, but never gets a raw send the
 * private RPC may already have taken, since a second copy could only revert or
 * come back as a nonce clash that looks like nothing went out. The fallback
 * also takes `retryCount` from `config` then, instead of its own default of 3.
 */
export function serverTransport(net: Net, config: HttpTransportConfig = {}, opts: { sendOnce?: boolean } = {}): Transport {
  const pub = net.chain.rpcUrls.default.http[0]!;
  const priv = privateRpc(net);
  if (!priv || priv === pub) return http(pub, config);
  if (!opts.sendOnce) return fallback([http(priv, config), http(pub, config)]);
  const backup = http(pub, { ...config, methods: { exclude: SEND_METHODS } });
  return fallback([http(priv, config), backup], { retryCount: config.retryCount });
}
