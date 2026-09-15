/**
 * Decimal-safe money and hours arithmetic.
 *
 * The plan (§8) requires decimal-safe arithmetic, specified rounding, and
 * exported totals that exactly match on-screen totals. Floating point gives
 * you none of those: 0.1 + 0.2 !== 0.3, and 1.005 rounds the wrong way.
 *
 * Everything here works in integer minor units (cents) via BigInt. Values
 * cross the database boundary as decimal STRINGS, never as JS numbers, so a
 * numeric(12,2) column never round-trips through a float.
 *
 * Rounding rule: half-up on the absolute value ("commercial rounding"), applied
 * once per line total. Subtotals sum already-rounded line totals — the same
 * order the database's generated column and the PDF export use.
 */

const SCALE = 2n;
const SCALE_FACTOR = 100n; // 10 ** SCALE

export class MoneyError extends Error {}

/**
 * Parse a user-entered decimal string into integer minor units.
 *
 * Values beyond two decimal places are REJECTED rather than truncated. An
 * earlier version accepted a `maxDecimals` override and quietly dropped the
 * extra digits, which turned "1.005" into "1.00" with no warning — precisely
 * the silent numeric corruption this module exists to prevent.
 */
export function parseDecimal(
  input: string | number | null | undefined,
  { field = "value" }: { field?: string } = {},
): bigint | null {
  if (input === null || input === undefined) return null;

  const raw = String(input).trim();
  if (raw === "") return null;

  // Reject anything that is not a plain decimal: no exponents, no thousands
  // separators, no currency symbols. Ambiguous input is a user error, not
  // something to guess at.
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) {
    throw new MoneyError(`Enter ${field} as a plain number, for example 3.5`);
  }

  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > Number(SCALE)) {
    throw new MoneyError(`${field} supports at most ${SCALE} decimal places`);
  }

  const padded = fraction.padEnd(Number(SCALE), "0");
  const minor = BigInt(whole ?? "0") * SCALE_FACTOR + BigInt(padded || "0");
  return sign === "-" ? -minor : minor;
}

/** Parse and reject negatives — used for hours and rates (plan §8). */
export function parseNonNegative(
  input: string | number | null | undefined,
  field: string,
): bigint | null {
  const value = parseDecimal(input, { field });
  if (value !== null && value < 0n) {
    throw new MoneyError(`${field} cannot be negative`);
  }
  return value;
}

/** Format integer minor units back to a fixed-2 decimal string. */
export function formatDecimal(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / SCALE_FACTOR;
  const fraction = abs % SCALE_FACTOR;
  return `${negative ? "-" : ""}${whole}.${fraction.toString().padStart(Number(SCALE), "0")}`;
}

/**
 * hours × rate, rounded half-up to 2 decimals.
 *
 * Both inputs are minor units (scale 2), so the raw product has scale 4 and
 * must be divided by SCALE_FACTOR. We do that division with explicit half-up
 * rounding rather than BigInt's truncating `/`.
 */
export function lineTotal(hours: bigint | null, rate: bigint | null): bigint {
  if (hours === null || rate === null) return 0n;

  const product = hours * rate; // scale 4
  return divideRoundHalfUp(product, SCALE_FACTOR);
}

/** Integer division with half-up rounding on the absolute value. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError("Division by zero");

  const negative = numerator < 0n !== denominator < 0n;
  const absN = numerator < 0n ? -numerator : numerator;
  const absD = denominator < 0n ? -denominator : denominator;

  const quotient = absN / absD;
  const remainder = absN % absD;

  // Half-up: round away from zero when the remainder is exactly half or more.
  const rounded = remainder * 2n >= absD ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Sum already-rounded line totals. Order of operations matches the export. */
export function sum(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

/**
 * Format for display with the project's currency.
 *
 * Uses Intl for symbol placement and grouping, but feeds it a value we
 * rounded ourselves, so the displayed figure is exactly the stored figure.
 */
export function formatMoney(minor: bigint, currency: string, locale = "en-US"): string {
  const decimal = formatDecimal(minor);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(decimal));
  } catch {
    // Unknown currency code — show the code rather than throwing.
    return `${decimal} ${currency}`;
  }
}

/** Format hours for display: 3.50 reads as "3.5", 4.00 as "4". */
export function formatHours(minor: bigint | null): string {
  if (minor === null) return "";
  return formatDecimal(minor).replace(/\.?0+$/, "");
}

/** Convert a database numeric string to minor units. */
export function fromDbNumeric(value: string | null): bigint | null {
  if (value === null) return null;
  return parseDecimal(value);
}

/** Convert minor units to a string safe to send to a numeric column. */
export function toDbNumeric(minor: bigint | null): string | null {
  return minor === null ? null : formatDecimal(minor);
}

export interface EstimateTotals {
  /** Line totals in minor units, in display order. */
  lines: bigint[];
  subtotal: bigint;
  /**
   * Tax amount in minor units. Null when no user-entered tax rate is set —
   * callers render no tax row at all rather than a misleading 0.00.
   */
  tax: bigint | null;
  /** Subtotal plus tax. Equals the subtotal when there is no tax rate. */
  total: bigint;
  /** True when at least one selected line is still missing hours. */
  incomplete: boolean;
}

/**
 * Tax on a subtotal from a user-entered percent rate.
 *
 * The rate is scale-2 minor units (825 = 8.25%), the subtotal is scale-2
 * minor units, so the product is scale 4 and is divided by 10^4 with the same
 * half-up rounding `lineTotal` uses. Rounded ONCE, here — nowhere else.
 */
export function taxAmount(subtotal: bigint, ratePercent: bigint | null): bigint | null {
  if (ratePercent === null) return null;
  return divideRoundHalfUp(subtotal * ratePercent, 100n * SCALE_FACTOR);
}

/**
 * The single place estimate totals are computed. The change-order export, the
 * invoice export and the on-screen table all call this, which is what makes
 * "exported totals exactly match on-screen totals" true by construction
 * rather than by luck.
 *
 * `taxRate` is the user-entered percent (minor units) from the change request.
 * The model is never its source, same as hours and rates.
 */
export function computeTotals(
  items: Array<{ hours: string | null; rate: string | null }>,
  taxRate: bigint | null = null,
): EstimateTotals {
  const lines = items.map((item) =>
    lineTotal(fromDbNumeric(item.hours), fromDbNumeric(item.rate)),
  );

  const subtotal = sum(lines);
  const tax = taxAmount(subtotal, taxRate);

  return {
    lines,
    subtotal,
    tax,
    total: tax === null ? subtotal : subtotal + tax,
    incomplete: items.some((item) => item.hours === null || item.rate === null),
  };
}
