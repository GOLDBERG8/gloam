/** Run from app/: ../mcp/node_modules/.bin/tsx scripts/selftest-payroll-inputs.mts */
import assert from "node:assert/strict";
import "./browser-shim.mjs";

const { parsePayrollCsv, fundingPlan } = await import("../src/lib/payroll");
const { formatExactAmount } = await import("../src/lib/amount");
const { saveSchedule, loadSchedules, deleteSchedule, newSchedule, MAX_PAYROLL_SCHEDULES } = await import("../src/lib/payrollSchedule");
const asset = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const pool = "0x39e28cde55cab798874746ac52cb4b5cc99a0194";

for (const delimiter of [";", "\t"]) {
  const csv = [["name", "gloam_address", "amount"], ["Ada", "", "1,25"]].map(row => row.join(delimiter)).join("\n");
  const parsed = parsePayrollCsv(csv, asset);
  assert.equal(parsed.rows[0].amountInput, "1,25");
  assert.equal(parsed.rows[0].amount, null);
  assert.match(parsed.rows[0].error!, /dot for decimals/);
}
assert.equal(parsePayrollCsv('name,amount,note\nAda,"1,250","salary; bonus"', asset).rows[0].amount, 1_250_000_000n);
assert.equal(parsePayrollCsv('name;amount;note\nAda;1.25;salary, bonus', asset).rows[0].note, "salary, bonus");
assert.equal(parsePayrollCsv('name\tgloam_address\tamount\n\t\t1.25', asset).rows[0].amount, 1_250_000n);
assert.equal(parsePayrollCsv('name,gloam_address,amount,note\nAda,,1.25', asset).rows[0].error, null);
for (const csv of ['name,amount\nAda,1,25', 'name;amount\nAda,1.25', 'name,amount\nAda,"1.25']) {
  const parsed = parsePayrollCsv(csv, asset);
  assert.ok(parsed.error || parsed.rows.some(row => row.error), csv);
}
console.log("ok: delimiters, decimal commas, quoted fields and malformed rows");

assert.equal(formatExactAmount(4_000n, 6, 2), "0.004");
assert.equal(formatExactAmount(12_000n, 6), "0.012");
assert.equal(formatExactAmount(1n, 18, 2), "0.000000000000000001");
assert.equal(formatExactAmount(1_000_000n, 6, 2), "1.00");
assert.equal(formatExactAmount(9007199254740993123456n, 6, 2), "9,007,199,254,740,993.123456");
console.log("ok: invoice and funding amounts preserve every token unit");

// Independent execution model: consume the smallest sufficient note, then its change.
function canPay(amounts: bigint[], notes: bigint[]) {
  const remaining = [...notes];
  for (const amount of amounts) {
    let best = -1;
    remaining.forEach((note, i) => { if (note >= amount && (best < 0 || note < remaining[best])) best = i; });
    if (best < 0) return false;
    remaining[best] -= amount;
  }
  return true;
}
const amounts = [1n, 1n, 2n, 2n];
const notes = [1n, 3n];
assert.equal(canPay(amounts, [...notes, 2n]), false, "the old suggestion still fails");
assert.ok(canPay(amounts, [...notes, fundingPlan(amounts, notes).shortfall]));
let seed = 314159;
const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
for (let sample = 0; sample < 5000; sample++) {
  const payments = Array.from({ length: 1 + random(12) }, () => BigInt(1 + random(30)));
  const available = Array.from({ length: random(10) }, () => BigInt(random(50)));
  const plan = fundingPlan(payments, available);
  assert.equal(plan.shortfall === 0n, canPay(payments, available));
  assert.ok(canPay(payments, [...available, plan.shortfall]), `sample ${sample}`);
  assert.ok(plan.shortfall <= payments.reduce((sum, amount) => sum + amount, 0n));
}
console.log("ok: 5,000 funding plans cover the full run with one suggested deposit");

const base = newSchedule({ name: "Team", chainId: 4663, pool, asset, cadence: { kind: "monthly", day: 1 }, cap: 100n, people: [] });
for (let i = 0; i < MAX_PAYROLL_SCHEDULES; i++) await saveSchedule({ ...base, id: `schedule-${i}`, chainId: i % 2 ? 4217 : 4663 });
const all = async () => [...await loadSchedules(4663, pool), ...await loadSchedules(4217, pool)];
const before = await all();
await assert.rejects(saveSchedule({ ...base, id: "overflow" }), /50 schedules/);
assert.deepEqual(await all(), before, "capacity rejection keeps every network's schedules");
await saveSchedule({ ...base, id: "schedule-0", name: "Edited" });
assert.equal((await all()).length, 50);
assert.equal((await all()).find(s => s.id === "schedule-0")?.name, "Edited");

const originalSet = window.localStorage.setItem;
try {
  window.localStorage.setItem = () => { throw new Error("Storage full"); };
  await assert.rejects(deleteSchedule("schedule-0"), /Storage full/);
  assert.ok((await all()).some(s => s.id === "schedule-0"));
} finally {
  window.localStorage.setItem = originalSet;
}
await deleteSchedule("schedule-0");
await saveSchedule({ ...base, id: "replacement" });
assert.equal((await all()).length, 50);
assert.ok(!(await all()).some(s => s.id === "schedule-0"));
console.log("ok: capacity, edits, failed deletion and recovery preserve schedules");
