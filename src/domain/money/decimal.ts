/**
 * Exact decimal helpers built on BigInt.
 *
 * Exchange rates and user-entered amounts arrive as decimal strings. They are
 * never converted to JavaScript floats; instead they are parsed into an
 * integer coefficient plus a scale (number of decimal places), so all
 * arithmetic stays exact.
 */

/** A non-negative or negative decimal number in plain notation, e.g. "1.0834". */
export type DecimalString = string;

export interface ParsedDecimal {
  /** The value without its decimal point, e.g. 10834n for "1.0834". */
  coefficient: bigint;
  /** Number of digits after the decimal point, e.g. 4 for "1.0834". */
  scale: number;
}

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

export const MAX_DECIMAL_SCALE = 18;

export class InvalidDecimalError extends Error {
  constructor(value: string) {
    super(`Invalid decimal value: "${value}"`);
    this.name = 'InvalidDecimalError';
  }
}

export function isDecimalString(value: string): value is DecimalString {
  const match = DECIMAL_PATTERN.exec(value);
  return match !== null && (match[3]?.length ?? 0) <= MAX_DECIMAL_SCALE;
}

export function parseDecimal(value: string): ParsedDecimal {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) throw new InvalidDecimalError(value);
  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > MAX_DECIMAL_SCALE) throw new InvalidDecimalError(value);
  const magnitude = BigInt(`${whole}${fraction}`);
  return { coefficient: sign ? -magnitude : magnitude, scale: fraction.length };
}

export function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new RangeError(`pow10 requires a non-negative integer, received ${exponent}`);
  }
  return 10n ** BigInt(exponent);
}

export type RoundingMode = 'half-away-from-zero' | 'half-even' | 'floor' | 'ceil' | 'truncate';

/**
 * Divides two BigInts and rounds the quotient to an integer using the given mode.
 * Financial default is half-away-from-zero (what consumers expect on receipts).
 */
export function divideAndRound(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = 'half-away-from-zero',
): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const quotient = numerator / denominator; // truncates toward zero
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;

  const isNegative = numerator < 0n;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  const awayFromZero = isNegative ? quotient - 1n : quotient + 1n;

  switch (mode) {
    case 'truncate':
      return quotient;
    case 'floor':
      return isNegative ? quotient - 1n : quotient;
    case 'ceil':
      return isNegative ? quotient : quotient + 1n;
    case 'half-away-from-zero':
      return twiceRemainder >= denominator ? awayFromZero : quotient;
    case 'half-even': {
      if (twiceRemainder > denominator) return awayFromZero;
      if (twiceRemainder < denominator) return quotient;
      return quotient % 2n === 0n ? quotient : awayFromZero;
    }
  }
}

/** Formats a coefficient/scale pair back into a plain decimal string. */
export function formatDecimal({ coefficient, scale }: ParsedDecimal): DecimalString {
  const isNegative = coefficient < 0n;
  const digits = (isNegative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? '' : `.${digits.slice(-scale)}`;
  return `${isNegative ? '-' : ''}${whole}${fraction}`;
}
