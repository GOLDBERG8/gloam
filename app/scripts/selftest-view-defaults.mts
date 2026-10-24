/** Run from app/: ../mcp/node_modules/.bin/tsx scripts/selftest-view-defaults.mts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(js, { module: loaded, exports: loaded.exports, require: (id: string) => {
    assert.ok(id in dependencies, `unexpected import ${id}`);
    return dependencies[id];
  }, ...globals });
  return loaded.exports;
}

// A controlled state lifecycle exercises late preference loading and explicit choices.
let stored: unknown = null;
const react = { useState: () => [stored, (value: unknown) => { stored = value; }] };
const { usePreferredChoice: renderChoice } = load("../src/hooks/usePreferredChoice.ts", { react }) as {
  usePreferredChoice: (preferred: string, key?: string) => readonly [string, (value: string) => void];
};
assert.equal(renderChoice("buy")[0], "buy");
assert.equal(renderChoice("sell")[0], "sell", "loaded preference wins before a choice");
renderChoice("sell")[1]("buy");
assert.equal(renderChoice("sell")[0], "buy", "user choice survives preference loading");
assert.equal(renderChoice("sell", "sell")[0], "sell", "new explicit URL resets the choice");
renderChoice("sell", "sell")[1]("buy");
assert.equal(renderChoice("sell", "sell")[0], "buy", "user may override the URL afterward");
stored = null;
assert.equal(renderChoice("all")[0], "all");
assert.equal(renderChoice("onchain")[0], "onchain");
renderChoice("onchain")[1]("stocks");
assert.equal(renderChoice("all")[0], "stocks");
console.log("ok: saved defaults, delayed loading, URL defaults and manual choices");

const previousZone = process.env.TZ;
process.env.TZ = "Europe/Berlin";
let now = new Date(2026, 9, 23, 23, 59, 59).getTime();
class ClockDate extends Date {
  constructor(...args: [] | [number] | [number, number, number]) {
    if (args.length === 0) super(now);
    else if (args.length === 1) super(args[0]);
    else super(...args);
  }
}
const timers = new Map<number, { at: number; call: () => void }>();
let id = 0;
const events = () => {
  const handlers = new Map<string, Set<() => void>>();
  return {
    addEventListener(event: string, cb: () => void) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event)!.add(cb); },
    removeEventListener(event: string, cb: () => void) { handlers.get(event)?.delete(cb); },
    dispatch(event: string) { handlers.get(event)?.forEach(cb => cb()); },
    count() { return [...handlers.values()].reduce((sum, values) => sum + values.size, 0); },
  };
};
const window = events(), document = events();
const { subscribeLocalDay } = load("../src/hooks/useLocalDay.ts", { react: {}, "@/lib/payrollSchedule": {} }, {
  Date: ClockDate, window, document,
  setTimeout: (call: () => void, delay: number) => { const handle = ++id; timers.set(handle, { at: now + delay, call }); return handle; },
  clearTimeout: (handle: number) => timers.delete(handle),
}) as { subscribeLocalDay: (refresh: () => void) => () => void };
let shown = "";
const refresh = () => { const date = new Date(now); shown = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`; };
const fire = () => {
  const entry = [...timers.entries()].find(([, timer]) => timer.at <= now);
  assert.ok(entry, "a due timer exists");
  timers.delete(entry[0]); entry[1].call();
};
try {
  const stop = subscribeLocalDay(refresh);
  try {
    fire(); assert.equal(shown, "2026-10-23");
    now += 1000; fire(); assert.equal(shown, "2026-10-24");
    now = new Date(2026, 9, 27, 10).getTime(); document.dispatch("visibilitychange");
    assert.equal(shown, "2026-10-27", "returning after suspension refreshes the day");
    now = new Date(2026, 2, 29).getTime(); window.dispatch("focus");
    assert.equal([...timers.values()][0].at - now, 23 * 3600000, "spring DST midnight");
    now = new Date(2026, 9, 25).getTime(); window.dispatch("focus");
    assert.equal([...timers.values()][0].at - now, 25 * 3600000, "autumn DST midnight");
  } finally { stop(); }
  assert.equal(timers.size, 0);
  assert.equal(window.count() + document.count(), 0);
  console.log("ok: midnight, resumed tabs, both DST changes and listener/timer cleanup");
} finally {
  if (previousZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousZone;
}
