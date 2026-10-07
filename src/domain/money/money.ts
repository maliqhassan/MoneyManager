import { type CurrencyCode, getMinorUnits } from '../currency/currencies';
import { divideAndRound, formatDecimal, parseDecimal, pow10, type RoundingMode } from './decimal';

/**
 * A monetary amount in integer minor units of a specific currency.
 *
 * USD 10.50 → { amountMinor: 1050, currency: 'USD' }
 * JPY 1,000 → { amountMinor: 1000, currency: 'JPY' }
 * KWD 1.250 → { amountMinor: 1250, currency: 'KWD' }
 *
 * Floats are never used for money. `amountMinor` is always a safe integer.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

/**
 * Upper bound for any single stored amount (absolute value). Keeps every value
 * and realistic sums well inside Number.MAX_SAFE_INTEGER (~9.007e15) so the
 * JS number representation stays exact.
 */
export const MAX_ABS_AMOUNT_MINOR = 1_000_000_000_000_000; // 1e15

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Cannot combine amounts in different currencies: ${a} and ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class AmountOutOfRangeError extends Error {
  constructor(value: number | bigint) {
    super(`Amount is not a safe integer within the allowed range: ${String(value)}`);
    this.name = 'AmountOutOfRangeError';
  }
}

export function isValidAmountMinor(value: number): boolean {
  return Number.isSafeInteger(value) && Math.abs(value) <= MAX_ABS_AMOUNT_MINOR;
}

function assertAmount(value: number): number {
  if (!isValidAmountMinor(value)) throw new AmountOutOfRangeError(value);
  // Normalise -0 so equality checks and serialisation are predictable.
  return value === 0 ? 0 : value;
}

function fromBigInt(value: bigint): number {
  const limit = BigInt(MAX_ABS_AMOUNT_MINOR);
  if (value > limit || value < -limit) throw new AmountOutOfRangeError(value);
  return assertAmount(Number(value));
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  return { amountMinor: assertAmount(amountMinor), currency };
}

export function zero(currency: CurrencyCode): Money {
  return { amountMinor: 0, currency };
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function negate(a: Money): Money {
  return money(-a.amountMinor, a.currency);
}

export function abs(a: Money): Money {
  return money(Math.abs(a.amountMinor), a.currency);
}

/** Sums amounts that must all share `currency`. Empty input yields zero. */
export function sum(amounts: readonly Money[], currency: CurrencyCode): Money {
  return amounts.reduce<Money>((total, item) => add(total, item), zero(currency));
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor === b.amountMinor) return 0;
  return a.amountMinor < b.amountMinor ? -1 : 1;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export const isZero = (a: Money): boolean => a.amountMinor === 0;
export const isPositive = (a: Money): boolean => a.amountMinor > 0;
export const isNegative = (a: Money): boolean => a.amountMinor < 0;

/** Returns the larger of two same-currency amounts. */
export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

/** Returns the smaller of two same-currency amounts. */
export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

/**
 * Multiplies by an exact decimal factor (e.g. "0.15" for 15%) and rounds back
 * to whole minor units.
 */
export function multiply(
  a: Money,
  factor: string,
  rounding: RoundingMode = 'half-away-from-zero',
): Money {
  const { coefficient, scale } = parseDecimal(factor);
  const result = divideAndRound(BigInt(a.amountMinor) * coefficient, pow10(scale), rounding);
  return { amountMinor: fromBigInt(result), currency: a.currency };
}

/**
 * Splits an amount into parts proportional to integer `ratios` without losing
 * or inventing a single minor unit (largest-remainder method). The parts always
 * sum exactly to the original amount. Used for split transactions and
 * spreading budgets across periods.
 */
export function allocate(a: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0) throw new RangeError('allocate requires at least one ratio');
  if (ratios.some((r) => !Number.isSafeInteger(r) || r < 0)) {
    throw new RangeError('allocate ratios must be non-negative integers');
  }
  const total = ratios.reduce((acc, r) => acc + r, 0);
  if (total === 0) throw new RangeError('allocate ratios must not all be zero');

  const amount = BigInt(a.amountMinor);
  const sign = amount < 0n ? -1n : 1n;
  const magnitude = amount * sign;
  const bigTotal = BigInt(total);

  const shares = ratios.map((ratio, index) => {
    const exact = magnitude * BigInt(ratio);
    return { index, base: exact / bigTotal, remainder: exact % bigTotal };
  });

  let leftover = magnitude - shares.reduce((acc, s) => acc + s.base, 0n);
  // Hand out leftover units to the largest remainders; ties go to earlier parts.
  const order = [...shares].sort((x, y) =>
    x.remainder === y.remainder ? x.index - y.index : x.remainder > y.remainder ? -1 : 1,
  );
  const extra = new Array<bigint>(ratios.length).fill(0n);
  for (const share of order) {
    if (leftover === 0n) break;
    extra[share.index] = 1n;
    leftover -= 1n;
  }

  return shares.map((s) => ({
    amountMinor: fromBigInt((s.base + (extra[s.index] ?? 0n)) * sign),
    currency: a.currency,
  }));
}

/**
 * Formats an amount as a plain, locale-independent major-unit string
 * ("1050" USD → "10.50"). For storage, export and form defaults —
 * use the i18n formatters for display.
 */
export function toMajorString(a: Money): string {
  return formatDecimal({ coefficient: BigInt(a.amountMinor), scale: getMinorUnits(a.currency) });
}
