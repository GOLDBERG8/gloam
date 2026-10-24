"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalDay } from "@/hooks/useLocalDay";
import type { Address } from "viem";
import { assetDecimals } from "@/lib/shield";
import {
  deleteSchedule,
  demoSchedule,
  loadSchedules,
  markSchedulePaid,
  saveSchedule,
  subscribeSchedules,
  withPaid,
  type PayrollSchedule,
} from "@/lib/payrollSchedule";

/**
 * The saved payroll schedules for this network and vault. In the recording
 * demo they live in memory only, seeded with one example that is due.
 */
export function useSchedules({
  chainId,
  pool,
  demo,
  demoAsset,
}: {
  chainId: number;
  pool: Address | null | undefined;
  demo: boolean;
  /** The currency the demo's example schedule pays in. */
  demoAsset: Address | undefined;
}) {
  const [schedules, setSchedules] = useState<PayrollSchedule[]>([]);
  const today = useLocalDay();
  // The example is seeded once per mount; a day change must not reset demo edits.
  const demoStart = useRef(today);

  useEffect(() => {
    if (!pool) return;
    let live = true;
    let version = 0;
    const refresh = () => {
      const current = ++version;
      const load = demo && demoAsset
        ? Promise.resolve([demoSchedule({ chainId, pool, asset: demoAsset, decimals: assetDecimals(demoAsset), today: demoStart.current })])
        : loadSchedules(chainId, pool);
      void load.then((list) => {
        if (live && current === version) setSchedules(list);
      });
    };
    const unsubscribe = demo ? () => {} : subscribeSchedules(refresh);
    refresh();
    return () => {
      live = false;
      unsubscribe();
    };
  }, [chainId, pool, demo, demoAsset]);

  // Saved first, shown after: a write refused because the stored schedules
  // cannot be opened must not look like it worked.
  const save = useCallback(
    async (edit: PayrollSchedule) => {
      const s = { ...edit, updatedAt: Date.now() };
      if (!demo) await saveSchedule(s);
      setSchedules((prev) => [s, ...prev.filter((x) => x.id !== s.id)]);
    },
    [demo]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!demo) await deleteSchedule(id).catch(() => undefined);
      setSchedules((prev) => prev.filter((x) => x.id !== id));
    },
    [demo]
  );

  const togglePause = useCallback(
    async (s: PayrollSchedule) => {
      await save({ ...s, paused: !s.paused }).catch(() => undefined);
    },
    [save]
  );

  /** A run for this schedule finished: it covered `payday`. */
  const markPaid = useCallback(
    async (id: string, payday: string, batchId: string) => {
      setSchedules((prev) => prev.map((s) => (s.id === id ? withPaid(s, payday, batchId) : s)));
      // A run that finished settles its payday from its own record too (see PayrollView), so a refused write here only costs the reminder.
      if (!demo) await markSchedulePaid(id, payday, batchId).catch(() => undefined);
    },
    [demo]
  );

  return { schedules, today, save, remove, togglePause, markPaid };
}
