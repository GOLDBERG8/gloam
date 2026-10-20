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

function privateRpc(net: Net): string | null {
  return process.env[`GLOAM_RPC_URL_${net.chainId}`]?.trim() || null;
}

export function serverTransport(net: Net, config: HttpTransportConfig = {}): Transport {
  const pub = net.chain.rpcUrls.default.http[0]!;
  const priv = privateRpc(net);
  return priv && priv !== pub ? fallback([http(priv, config), http(pub, config)]) : http(pub, config);
}
