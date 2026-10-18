import {
  type DecimalString,
  divideAndRound,
  formatDecimal,
  MAX_DECIMAL_SCALE,
  parseDecimal,
  pow10,
} from '../money/decimal';

/**
 * Exact rate arithmetic. A rate is a positive decimal string meaning
 * "1 unit of base = rate units of quote" (see docs/exchange-rates.md).
 *
 * Derived rates (inverse, cross) are computed with BigInt and rounded ONCE,
 * half away from zero, to DERIVED_RATE_SIGNIFICANT_DIGITS significant digits
 * (never more than 18 decimals). Amounts are then converted with that
 * decimal, so a stored rate always reproduces the stored converted amount.
 */

export const DERIVED_RATE_SIGNIFICANT_DIGITS = 12;
/** Accepted rate range: anything outside is a data error, not a market rate. */
export const MIN_RATE = '0.000000001'; // 1e-9
export const MAX_RATE = '1000000000'; // 1e9
/** Max digits in a rate (whole + fraction). */
const MAX_RATE_DIGITS = 30;

export class InvalidRateError extends Error {
  constructor(
    readonly reason: 'format' | 'non_positive' | 'precision' | 'range',
    value: string,
  ) {
    super(`Invalid exchange rate "${value}" (${reason})`);
    this.name = 'InvalidRateError';
  }
}

const PLAIN = /^(\d+)(?:\.(\d+))?$/;

/** Rational value of a decimal string as numerator / 10^scale. */
interface Ratio {
  num: bigint;
  den: bigint;
}

function ratio(value: DecimalString): Ratio {
  const { coefficient, scale } = parseDecimal(value);
  return { num: coefficient, den: pow10(scale) };
}

function compareRatio(a: Ratio, b: Ratio): number {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

/** Removes redundant zeros: "001.2300" → "1.23", "5.0" → "5". */
function canonical(whole: string, fraction: string): DecimalString {
  const w = whole.replace(/^0+(?=\d)/, '');
  const f = fraction.replace(/0+$/, '');
  return f ? `${w}.${f}` : w;
}

/**
 * Validates and canonicalises a rate. Rejects non-decimal text, zero or
 * negative values, more than 18 decimals and values outside [1e-9, 1e9].
 */
export function validateRate(value: string): DecimalString {
  const text = value.trim();
  const match = PLAIN.exec(text);
  if (!match) throw new InvalidRateError('format', value);
  const [, whole = '0', fraction = ''] = match;
  if (fraction.length > MAX_DECIMAL_SCALE) throw new InvalidRateError('precision', value);
  const out = canonical(whole, fraction);
  if (out.replace('.', '').length > MAX_RATE_DIGITS) throw new InvalidRateError('precision', value);
  const r = ratio(out);
  if (r.num <= 0n) throw new InvalidRateError('non_positive', value);
  if (compareRatio(r, ratio(MIN_RATE)) < 0 || compareRatio(r, ratio(MAX_RATE)) > 0) {
    throw new InvalidRateError('range', value);
  }
  return out;
}

/**
 * Converts a JSON number literal (possibly with an exponent, e.g. "2.5e-7")
 * to a plain decimal string exactly, by moving the decimal point — no float
 * is ever produced. Returns null for anything that is not a JSON number.
 */
export function numberLiteralToDecimal(literal: string): DecimalString | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(literal);
  if (!match) return null;
  const [, sign = '', whole = '0', fraction = '', exponentText] = match;
  const exponent = exponentText ? Number.parseInt(exponentText, 10) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 40) return null;
  let digits = whole + fraction;
  let point = whole.length + exponent;
  if (point <= 0) {
    digits = '0'.repeat(1 - point) + digits;
    point = 1;
  }
  if (point > digits.length) digits = digits + '0'.repeat(point - digits.length);
  const out = canonical(digits.slice(0, point), digits.slice(point));
  return sign && out !== '0' ? `-${out}` : out;
}

/** num / den rounded to `significant` significant digits (max 18 decimals). */
function toSignificant(num: bigint, den: bigint, significant: number): DecimalString {
  if (num <= 0n || den <= 0n) throw new InvalidRateError('non_positive', `${num}/${den}`);
  // Number of whole digits of num/den (may be ≤ 0 for values below 1).
  let magnitude = num.toString().length - den.toString().length;
  if (num * pow10(Math.max(0, -magnitude)) < den * pow10(Math.max(0, magnitude))) magnitude -= 1;
  // magnitude = floor(log10(value)); digits before the point = magnitude + 1.
  let scale = Math.min(MAX_DECIMAL_SCALE, Math.max(0, significant - (magnitude + 1)));
  let coefficient = divideAndRound(num * pow10(scale), den);
  if (coefficient === 0n) {
    // Smaller than the 18th decimal: not representable as a rate.
    throw new InvalidRateError('range', `${num}/${den}`);
  }
  // Rounding up may add a digit (9.99… → 10.0…); trim one decimal if so.
  if (coefficient.toString().length > significant && scale > 0) {
    scale -= 1;
    coefficient = divideAndRound(num * pow10(scale), den);
  }
  const plain = formatDecimal({ coefficient, scale });
  const [w = '0', f = ''] = plain.split('.');
  return canonical(w, f);
}

/** One stored rate used as a step of a derivation, optionally inverted (1/rate). */
export interface RateLeg {
  rate: DecimalString;
  inverted: boolean;
}

/**
 * Multiplies the legs exactly (each leg is `rate` or `1/rate`) and rounds
 * once. A single non-inverted leg is returned unchanged (canonicalised).
 *
 * Examples: inverse EUR→USD from USD→EUR = [{ USD→EUR, inverted }];
 * cross PKR→EUR via USD = [{ USD→PKR, inverted }, { USD→EUR }].
 */
export function deriveRate(legs: readonly RateLeg[]): DecimalString {
  if (legs.length === 0) throw new InvalidRateError('format', '(no legs)');
  if (legs.length === 1 && !legs[0]!.inverted) return validateRate(legs[0]!.rate);
  let num = 1n;
  let den = 1n;
  for (const leg of legs) {
    const r = ratio(validateRate(leg.rate));
    num *= leg.inverted ? r.den : r.num;
    den *= leg.inverted ? r.num : r.den;
  }
  return validateRate(toSignificant(num, den, DERIVED_RATE_SIGNIFICANT_DIGITS));
}

/** 1 / rate, exact then rounded to 12 significant digits. */
export function inverseRate(rate: DecimalString): DecimalString {
  return deriveRate([{ rate, inverted: true }]);
}
