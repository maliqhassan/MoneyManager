import type { CurrencyCode } from '../currency/currencies';
import { getMinorUnits } from '../currency/currencies';
import { convert } from '../money/conversion';
import { type DecimalString, divideAndRound, formatDecimal, pow10 } from '../money/decimal';
import { type Money, money } from '../money/money';

export class InvalidTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransferError';
  }
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  /** Positive amount leaving the source account. */
  fromAmountMinor: number;
  /**
   * Positive amount that arrived in the destination account. Required for
   * cross-currency transfers unless `fxRate` is given (actual bank amount is
   * preferred over a computed one).
   */
  toAmountMinor?: number;
  fxRate?: DecimalString;
}

export interface TransferLegs {
  /** Negative posting on the source account. */
  outgoing: Money;
  /** Positive posting on the destination account. */
  incoming: Money;
  /** from → to rate; "1" for same-currency transfers. */
  fxRate: DecimalString;
}

const RATE_SCALE = 10;

/** Exact implied rate to.major / from.major, rounded to RATE_SCALE decimals. */
export function impliedRate(from: Money, to: Money): DecimalString {
  if (from.amountMinor <= 0 || to.amountMinor <= 0) {
    throw new InvalidTransferError('Implied rate requires positive amounts');
  }
  const numerator =
    BigInt(to.amountMinor) * pow10(getMinorUnits(from.currency)) * pow10(RATE_SCALE);
  const denominator = BigInt(from.amountMinor) * pow10(getMinorUnits(to.currency));
  const coefficient = divideAndRound(numerator, denominator);
  return formatDecimal({ coefficient, scale: RATE_SCALE }).replace(/\.?0+$/, '');
}

/**
 * Builds the two balanced postings of a transfer. A transfer never changes the
 * user's net worth in a single currency: outgoing + incoming = 0.
 */
export function buildTransferLegs(input: TransferInput): TransferLegs {
  if (input.fromAccountId === input.toAccountId) {
    throw new InvalidTransferError('Source and destination accounts must differ');
  }
  if (!Number.isSafeInteger(input.fromAmountMinor) || input.fromAmountMinor <= 0) {
    throw new InvalidTransferError(
      'Transfer amount must be a positive whole number of minor units',
    );
  }
  const outgoingAbs = money(input.fromAmountMinor, input.fromCurrency);

  if (input.fromCurrency === input.toCurrency) {
    if (input.toAmountMinor !== undefined && input.toAmountMinor !== input.fromAmountMinor) {
      throw new InvalidTransferError('Same-currency transfer amounts must match');
    }
    return {
      outgoing: money(-input.fromAmountMinor, input.fromCurrency),
      incoming: money(input.fromAmountMinor, input.toCurrency),
      fxRate: '1',
    };
  }

  let incoming: Money;
  let fxRate: DecimalString;
  if (input.toAmountMinor !== undefined) {
    if (!Number.isSafeInteger(input.toAmountMinor) || input.toAmountMinor <= 0) {
      throw new InvalidTransferError('Received amount must be positive');
    }
    incoming = money(input.toAmountMinor, input.toCurrency);
    fxRate = impliedRate(outgoingAbs, incoming);
  } else if (input.fxRate !== undefined) {
    incoming = convert(outgoingAbs, input.fxRate, input.toCurrency);
    fxRate = input.fxRate;
  } else {
    throw new InvalidTransferError('Cross-currency transfers need a received amount or a rate');
  }

  return { outgoing: money(-input.fromAmountMinor, input.fromCurrency), incoming, fxRate };
}
