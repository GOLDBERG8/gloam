import type { Address, PublicClient } from "viem";

/** Estimate a native send while reserving gas, without submitting a transaction. */
export async function maxNativeSend(
  client: Pick<PublicClient, "getBalance" | "estimateGas" | "estimateFeesPerGas">,
  account: Address,
  to: Address,
): Promise<bigint> {
  const [balance, fees] = await Promise.all([
    client.getBalance({ address: account, blockTag: "pending" }),
    client.estimateFeesPerGas().catch(() => client.estimateFeesPerGas({ chain: undefined, type: "legacy" })),
  ]);
  const feePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  if (feePerGas == null || feePerGas <= 0n) throw new Error("Could not estimate the network fee. Try again.");
  let gas = await client.estimateGas({ account, to, value: 0n, ...fees });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (gas <= 0n) throw new Error("Could not estimate the network fee. Try again.");
    const gasLimit = (gas * 120n + 99n) / 100n;
    const reserve = gasLimit * feePerGas;
    if (balance <= reserve) throw new Error("Not enough ETH to cover the estimated network fee.");
    const value = balance - reserve;
    // Receivers can use different gas depending on the amount. Validate the
    // actual candidate too; never fall back to spending the entire balance.
    const checkedGas = await client.estimateGas({ account, to, value, ...fees });
    if (checkedGas <= 0n) throw new Error("Could not estimate the network fee. Try again.");
    if (checkedGas <= gasLimit) return value;
    gas = checkedGas;
  }
  throw new Error("The fee estimate keeps changing. Enter an amount manually or try again.");
}
