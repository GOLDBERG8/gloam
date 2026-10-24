"use client";

import { useEffect, useState } from "react";
import { isoDay } from "@/lib/payrollSchedule";

/** Refresh after local midnight, including DST changes and suspended tabs. */
export function subscribeLocalDay(refresh: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    clearTimeout(timer);
    refresh();
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = setTimeout(tick, Math.max(1, midnight.getTime() - now.getTime()));
  };
  timer = setTimeout(tick, 0);
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", tick);
    document.removeEventListener("visibilitychange", tick);
  };
}

export function useLocalDay(): string {
  const [today, setToday] = useState(() => isoDay());
  useEffect(() => subscribeLocalDay(() => setToday(isoDay())), []);
  return today;
}
