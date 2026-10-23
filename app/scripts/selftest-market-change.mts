/**
 * Self-test: a stock's "24h" change is the day's change, against the previous
 * session's close (lib/live-quotes yahooDayChange), never against the close
 * before a three-month chart began. Review finding 7, 23 Oct 2026: PLTR showed
 * +57.49% on a day it was down about 2.74%.
 *
 * Run from app/:  ../mcp/node_modules/.bin/tsx scripts/selftest-market-change.mts
 */
import assert from "node:assert/strict";

const { yahooDayChange } = await import("../src/lib/live-quotes");

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

/** Yahoo's chart for PLTR, interval=1d&range=3mo, as read on 23 Oct 2026 (the last four bars). */
const pltr = {
  meta: {
    regularMarketPrice: 196.19,
    regularMarketTime: 1792699201,
    previousClose: null,
    chartPreviousClose: 124.57,
  },
  timestamp: [1792416600, 1792503000, 1792589400, 1792675800],
  indicators: { quote: [{ close: [194.14999389648438, 192.60000610351562, 201.72000122070312, 196.19000244140625] }] },
};

test("PLTR: the day's change, not the three-month one", () => {
  assert.equal(yahooDayChange(pltr), -2.74);
  assert.notEqual(yahooDayChange(pltr), 57.49);
});

test("Yahoo's own previous close wins when it is there", () => {
  assert.equal(yahooDayChange({ ...pltr, meta: { ...pltr.meta, regularMarketPreviousClose: 200 } }), -1.91);
  assert.equal(yahooDayChange({ ...pltr, meta: { ...pltr.meta, previousClose: 190 } }), 3.26);
});

test("before today's bar exists, the price's own session is the last bar", () => {
  // the price is Wednesday's close; the latest bar is Wednesday's
  const wed = {
    ...pltr,
    meta: { ...pltr.meta, regularMarketPrice: 201.72, regularMarketTime: 1792612800 },
    timestamp: pltr.timestamp.slice(0, 3),
    indicators: { quote: [{ close: pltr.indicators.quote[0].close.slice(0, 3) }] },
  };
  assert.equal(yahooDayChange(wed), 4.74, "Wednesday against Tuesday");
  // a bar after the price's time (not usual, but never compared against itself)
  assert.equal(yahooDayChange({ ...wed, timestamp: pltr.timestamp, indicators: pltr.indicators }), 4.74);
});

test("gaps and missing data: skip empty bars, and no baseline means no number", () => {
  const gap = { ...pltr, indicators: { quote: [{ close: [194.15, 201.72, null, 196.19] }] } };
  assert.equal(yahooDayChange(gap), -2.74, "the close before an empty bar");
  assert.equal(yahooDayChange({ meta: { regularMarketPrice: 10, chartPreviousClose: 5 } }), null, "never the chart's start");
  assert.equal(yahooDayChange({ meta: { regularMarketPrice: 10 }, indicators: { quote: [{ close: [10] }] } }), null);
  assert.equal(yahooDayChange(undefined), null);
});

console.log(`\nmarket change: ${passed} passed`);
