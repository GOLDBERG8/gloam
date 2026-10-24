/** Run from app/: ../mcp/node_modules/.bin/tsx scripts/selftest-schedule-store.mts */
import assert from "node:assert/strict";
import { localStorage } from "./browser-shim.mjs";
import { sealJson } from "../src/lib/noteVault";
import * as first from "../src/lib/payrollSchedule";

const key = "gloam.payroll.schedules.v1";
const pool = "0x39e28cde55cab798874746ac52cb4b5cc99a0194";
const asset = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const base = first.newSchedule({ name: "Team", chainId: 4663, pool, asset, cadence: { kind: "weekly", weekday: 5 }, cap: 100n, people: [] });
const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const queues = new Map<string, Promise<unknown>>();
const locks = { request<T>(name: string, fn: () => Promise<T>) {
  const run = (queues.get(name) ?? Promise.resolve()).then(fn, fn);
  queues.set(name, run.catch(() => undefined));
  return run;
} };
try {
  for (const useLocks of [true, false]) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: useLocks ? { locks } : undefined });
    localStorage.removeItem(key);
    const second = await import(`../src/lib/payrollSchedule.ts?tab=${useLocks}`) as typeof first;
    assert.notEqual(first.saveSchedule, second.saveSchedule, "tabs must have independent write queues");
    let notifications = 0;
    const stop = first.subscribeSchedules(() => notifications++);
    try {
      await Promise.all([first.saveSchedule({ ...base, id: "a" }), second.saveSchedule({ ...base, id: "b" })]);
      assert.deepEqual((await first.loadSchedules(4663, pool)).map(s => s.id).sort(), ["a", "b"]);
      await Promise.all([first.deleteSchedule("a"), second.saveSchedule({ ...base, id: "c" })]);
      assert.deepEqual((await first.loadSchedules(4663, pool)).map(s => s.id).sort(), ["b", "c"]);
      await Promise.all([first.markSchedulePaid("b", "2026-10-23", "paid"), second.saveSchedule({ ...base, id: "d" })]);
      assert.equal((await first.loadSchedules(4663, pool)).find(s => s.id === "b")?.paidThrough, "2026-10-23");
      assert.equal(notifications, 6);
      const external = new Event("storage");
      Object.assign(external, { key });
      window.dispatchEvent(external);
      assert.equal(notifications, 7);
      stop();
      window.dispatchEvent(external);
      assert.equal(notifications, 7, "listeners removed");
      console.log(`ok: concurrent save/delete/payment updates and notifications, locks=${useLocks}`);
    } finally { stop(); }

    const existing = Array.from({ length: first.MAX_PAYROLL_SCHEDULES - 1 }, (_, i) => ({ ...base, id: `existing-${i}` }));
    localStorage.setItem(key, await sealJson(existing));
    const additions = await Promise.allSettled([
      first.saveSchedule({ ...base, id: "last-slot-a" }),
      second.saveSchedule({ ...base, id: "last-slot-b" }),
    ]);
    assert.equal(additions.filter(result => result.status === "fulfilled").length, 1);
    const refused = additions.find(result => result.status === "rejected");
    assert.equal(refused?.status, "rejected");
    if (refused?.status === "rejected") assert.match(String(refused.reason), /save up to 50 schedules/);
    let saved = await first.loadSchedules(4663, pool);
    assert.equal(saved.length, first.MAX_PAYROLL_SCHEDULES);
    assert.ok(existing.every(schedule => saved.some(item => item.id === schedule.id)), "neither tab may evict an existing schedule");
    await first.saveSchedule({ ...existing[0], name: "Updated at capacity" });
    saved = await first.loadSchedules(4663, pool);
    assert.equal(saved.length, first.MAX_PAYROLL_SCHEDULES);
    assert.equal(saved.find(schedule => schedule.id === existing[0].id)?.name, "Updated at capacity");
    await second.deleteSchedule(existing[1].id);
    await first.saveSchedule({ ...base, id: "freed-slot" });
    assert.equal((await first.loadSchedules(4663, pool)).length, first.MAX_PAYROLL_SCHEDULES);

    // Updating a store already above the limit must not silently truncate it.
    const oversized = Array.from({ length: first.MAX_PAYROLL_SCHEDULES + 1 }, (_, i) => ({ ...base, id: `legacy-${i}` }));
    localStorage.setItem(key, await sealJson(oversized));
    await first.saveSchedule({ ...oversized[0], name: "Preserved" });
    assert.equal((await first.loadSchedules(4663, pool)).length, oversized.length);
    await assert.rejects(second.saveSchedule({ ...base, id: "over-capacity" }), /save up to 50 schedules/);
    console.log(`ok: concurrent capacity limit, updates, freed slots and no truncation, locks=${useLocks}`);
    localStorage.setItem(key, await sealJson([base]));
  }
  const before = localStorage.getItem(key);
  const set = localStorage.setItem.bind(localStorage);
  try {
    localStorage.setItem = (k, v) => { if (k === key) throw new Error("Storage full"); set(k, v); };
    await assert.rejects(first.saveSchedule({ ...base, id: "refused" }), /Storage full/);
    await assert.rejects(first.deleteSchedule(base.id), /Storage full/);
    assert.equal(localStorage.getItem(key), before);
  } finally { localStorage.setItem = set; }
  await first.saveSchedule({ ...base, id: "after-failure" });
  assert.ok((await first.loadSchedules(4663, pool)).some(s => s.id === "after-failure"));
  console.log("ok: rejected writes preserve storage and do not poison the queue");
} finally {
  if (navigatorBefore) Object.defineProperty(globalThis, "navigator", navigatorBefore);
  else Reflect.deleteProperty(globalThis, "navigator");
}
