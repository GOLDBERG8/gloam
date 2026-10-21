/**
 * The seller: a paid API on Hono, charged per request over MPP with the
 * private "gloam" method. mppx issues the 402 challenge and checks the
 * challenge binding; the gloam method checks the payment, sweeps it into a
 * fresh note only this server knows, and only then lets the route run.
 *
 *   GET /health   free
 *   GET /answer   0.01 of the network's stablecoin per request, paid privately
 */
import type { Address } from "viem";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { Mppx } from "mppx/hono";
import { gloam } from "@gloamtrade/mppx-gloam/server";
import type { GloamChargeChain, GloamSubmitter } from "@gloamtrade/mppx-gloam/core";
import type { NoteExport, Prover, ReceiveKey } from "@gloamtrade/sdk";

export interface PaidApiOptions {
  /** Chain id of the network to price on. Its official Gloam pool is where payments settle. */
  chainId: number;
  /** The stablecoin to price in, and its decimals. */
  currency: Address;
  decimals: number;
  /** The seller's receive key. Its tag is where every payment is sealed. */
  receiveKey: ReceiveKey;
  /** Chain reads (gloamChargeChainFromClient(publicClient, ...) against a real RPC). */
  chain: GloamChargeChain;
  /** Who submits the sweep (and the payer's transfer in pull mode): a wallet, or relaySubmitter(). */
  submit: GloamSubmitter;
  /** Transfer-circuit prover for the sweep. */
  prove: Prover;
  /** At least 32 random bytes, kept server side: binds challenge ids. */
  secretKey: string;
  /** The seller's fresh note after each sweep. Its secret is the money: persist it. */
  onFreshNote: (note: NoteExport) => void;
}

export function createPaidApi(o: PaidApiOptions) {
  const mppx = Mppx.create({
    secretKey: o.secretKey,
    methods: [
      gloam({
        network: o.chainId,
        currency: o.currency,
        decimals: o.decimals,
        receiveKey: o.receiveKey,
        chain: o.chain,
        prove: o.prove,
        submit: o.submit,
        beforeSubmit: (fresh) => o.onFreshNote(fresh),
      }),
    ],
  });

  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/answer", mppx.charge({ amount: "0.01", description: "One answer, paid privately" }), (c) =>
    c.json({ answer: 42, note: "Served after the payment was swept into a note only the seller knows." })
  );
  return app;
}

/** Serve a Fetch handler on node:http, bound to localhost. (Production MPP must run behind TLS.) */
export async function listen(handler: (req: Request) => Response | Promise<Response>, port = 0) {
  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  const server = createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) for (const x of v) headers.append(k, x);
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers,
        body: hasBody ? new Uint8Array(await readBody(req)) : undefined,
      });
      const response = await handler(request);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.writeHead(response.status);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(e instanceof Error ? e.message : String(e));
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: bound } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${bound}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
