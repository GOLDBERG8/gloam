import { amountTextError } from "@/lib/amountText";

/**
 * One short line under an amount field when what was typed isn't a plain
 * amount ("1,25", "-1", "1e5"). Fields keep exactly what was typed; this says
 * why it won't be used instead of quietly changing it.
 */
export function AmountProblem({ value, decimals, id }: { value: string; decimals?: number; id?: string }) {
  const message = amountTextError(value, decimals);
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-2 text-[12.5px] leading-relaxed text-danger">
      {message}
    </p>
  );
}
