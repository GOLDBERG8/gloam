/**
 * Reading a wallet error for one question: could the transaction have gone
 * out? Secrets kept ahead of a send (a note, a claim code) may only be dropped
 * when it surely did not. A timeout or a lost reply, from WalletConnect say,
 * can come after the wallet already sent it, so anything else keeps them.
 */

type ErrorLike = { name?: string; code?: number; message?: string; shortMessage?: string; cause?: unknown };

function chain(e: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let x = e as ErrorLike | undefined;
  for (let i = 0; x && typeof x === "object" && i < 8; i++, x = x.cause as ErrorLike | undefined) out.push(x);
  return out;
}

/** The person turned the wallet prompt down. */
export function walletDeclined(e: unknown): boolean {
  return chain(e).some(
    (x) =>
      x.name === "UserRejectedRequestError" ||
      x.code === 4001 ||
      (typeof x.message === "string" && /user (rejected|denied)|rejected the request|request rejected/i.test(x.message))
  );
}

/** Failed before anything reached the network: the wrong chain, a call that would revert, no gas. */
const BEFORE_SEND = new Set([
  "ChainMismatchError",
  "ConnectorChainMismatchError",
  "ConnectorNotConnectedError",
  "SwitchChainError",
  "ContractFunctionRevertedError",
  "EstimateGasExecutionError",
  "InsufficientFundsError",
]);

export function failedBeforeSend(e: unknown): boolean {
  return chain(e).some((x) => typeof x.name === "string" && BEFORE_SEND.has(x.name));
}

/** The transaction surely never went out, so what was kept ahead of it can go. */
export function surelyNotSent(e: unknown): boolean {
  return walletDeclined(e) || failedBeforeSend(e);
}

/** The short, human part of a wallet or viem error (viem's long message lists the chain and call). */
export function walletErrorText(e: unknown): string {
  const first = chain(e)[0];
  const text = first?.shortMessage || first?.message || "";
  return text.split("\n")[0] ?? "";
}
