import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeTotals,
  formatDecimal,
  formatHours,
  lineTotal,
  MoneyError,
  parseDecimal,
  parseNonNegative,
  sum,
  taxAmount,
} from "./money.ts";

test("parses plain decimals into minor units", () => {
  assert.equal(parseDecimal("3.5"), 350n);
  assert.equal(parseDecimal("0.05"), 5n);
  assert.equal(parseDecimal("120"), 12000n);
  assert.equal(parseDecimal(""), null);
  assert.equal(parseDecimal(null), null);
});

test("rejects ambiguous numeric input rather than guessing", () => {
  assert.throws(() => parseDecimal("1,200"), MoneyError);
  assert.throws(() => parseDecimal("$95"), MoneyError);
  assert.throws(() => parseDecimal("1e3"), MoneyError);
  assert.throws(() => parseDecimal("3.999"), MoneyError);
  assert.throws(() => parseNonNegative("-4", "Hours"), MoneyError);
});

test("survives the float traps the plan cares about", () => {
  // 0.1 + 0.2 === 0.30000000000000004 in float arithmetic.
  assert.equal(formatDecimal(sum([parseDecimal("0.1")!, parseDecimal("0.2")!])), "0.30");

  // 0.5h at 33.33 is exactly 16.665. Float gives 16.664999999999999, which
  // rounds DOWN to 16.66; exact half-up arithmetic gives 16.67.
  assert.equal(formatDecimal(lineTotal(50n, 3333n)), "16.67");
  assert.equal((0.5 * 33.33).toFixed(2), "16.66"); // what float would have done
});

test("refuses to silently truncate excess precision", () => {
  assert.throws(() => parseDecimal("1.005"), MoneyError);
});

test("line total rounds half-up at two decimals", () => {
  // 2.5 hours at 33.33/hr = 83.325 -> 83.33
  assert.equal(formatDecimal(lineTotal(250n, 3333n)), "83.33");
  // 1.5 hours at 0.01/hr = 0.015 -> 0.02
  assert.equal(formatDecimal(lineTotal(150n, 1n)), "0.02");
  // Missing hours contribute nothing rather than throwing.
  assert.equal(formatDecimal(lineTotal(null, 9500n)), "0.00");
});

test("subtotal sums rounded line totals, matching the export order", () => {
  const totals = computeTotals([
    { hours: "2.50", rate: "33.33" }, // 83.325 -> 83.33
    { hours: "2.50", rate: "33.33" }, // 83.325 -> 83.33
  ]);

  // Rounding each line then summing gives 166.66, not 166.65.
  assert.equal(formatDecimal(totals.subtotal), "166.66");
  assert.equal(totals.incomplete, false);
});

test("totals report incompleteness when hours are unentered", () => {
  const totals = computeTotals([
    { hours: null, rate: "95.00" },
    { hours: "4", rate: "95.00" },
  ]);

  assert.equal(totals.incomplete, true);
  assert.equal(formatDecimal(totals.subtotal), "380.00");
});

test("tax computes from a user-entered rate, rounded half-up once", () => {
  // $100 at 8.25% = $8.25 exactly.
  assert.equal(formatDecimal(taxAmount(10000n, 825n)!), "8.25");

  // $0.10 at 8.25% = $0.00825 -> half-up -> $0.01.
  assert.equal(formatDecimal(taxAmount(10n, 825n)!), "0.01");

  // $0.05 at 8.25% = $0.004125 -> rounds down to $0.00.
  assert.equal(formatDecimal(taxAmount(5n, 825n)!), "0.00");

  // No rate means no tax — callers render no row, not a misleading 0.00.
  assert.equal(taxAmount(10000n, null), null);

  // 0% is a legitimate entered rate and yields a real 0.
  assert.equal(formatDecimal(taxAmount(10000n, 0n)!), "0.00");
});

test("computeTotals threads tax through to the grand total", () => {
  const totals = computeTotals([{ hours: "2", rate: "50.00" }], parseDecimal("8.25")!);

  assert.equal(formatDecimal(totals.subtotal), "100.00");
  assert.equal(formatDecimal(totals.tax!), "8.25");
  assert.equal(formatDecimal(totals.total), "108.25");

  // Without a rate the total is the subtotal and no tax row exists.
  const untaxed = computeTotals([{ hours: "2", rate: "50.00" }]);
  assert.equal(untaxed.tax, null);
  assert.equal(formatDecimal(untaxed.total), "100.00");
});

test("formats hours without noisy trailing zeros", () => {
  assert.equal(formatHours(350n), "3.5");
  assert.equal(formatHours(400n), "4");
  assert.equal(formatHours(null), "");
});
