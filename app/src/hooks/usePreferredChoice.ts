"use client";

import { useState } from "react";

/** Follow a loaded preference until the person makes a choice in this view. */
export function usePreferredChoice<T>(preferred: T, resetKey = "") {
  const [choice, setChoice] = useState<{ value: T; key: string } | null>(null);
  return [choice === null || choice.key !== resetKey ? preferred : choice.value,
    (value: T) => setChoice({ value, key: resetKey })] as const;
}
