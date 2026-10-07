import { type CurrencyCode, getMinorUnits } from '../currency/currencies';
import {
  type DecimalString,
  divideAndRound,
  isDecimalString,
  parseDecimal,
  pow10,
  type RoundingMode,
} from './decimal';
import { AmountOutOfRangeError, MAX_ABS_AMOUNT_MINOR, type Money } from './money';

/**
 * An exchange rate quoting how many units of `quote` one unit of `base` buys.
 * Rates are exact decimal strings — never floats.
 *
 * { base: 'EUR', quote: 'USD', rate: '1.0834' } means 1 EUR = 1.0834 USD.
 */
export interface ExchangeRate {
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: DecimalString;
  /** Date the rate applies to (YYYY-MM-DD). */
  rateDate: string;
  /** Where the rate came from, e.g. "manual", "ecb", "provider:<name>". */
  source: string;
}

export class InvalidExchangeRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExchangeRateError';
  }
}

/**
 * Converts `amount` into `target` using `rate` (1 unit of amount.currency =
 * `rate` units of target). Handles differing minor-unit exponents
 * (e.g. USD → JPY) exactly using BigInt.
 */
export function convert(
  amount: Money,
  rate: DecimalString,
  target: CurrencyCode,
  rounding: RoundingMode = 'half-away-from-zero',
): Money {
  if (!isDecimalString(rate)) throw new InvalidExchangeRateError(`Invalid rate "${rate}"`);
  const { coefficient, scale } = parseDecimal(rate);
  if (coefficient <= 0n) throw new InvalidExchangeRateError('Exchange rate must be positive');
  if (amount.currency === target) {
    if (coefficient !== pow10(scale)) {
      throw new InvalidExchangeRateError(`Same-currency conversion requires rate 1, got ${rate}`);
    }
    return amount;
  }

  const sourceExp = getMinorUnits(amount.currency);
  const targetExp = getMinorUnits(target);

  // target_minor = amount_minor / 10^sourceExp * rate * 10^targetExp
  const numerator = BigInt(amount.amountMinor) * coefficient * pow10(targetExp);
  const denominator = pow10(scale + sourceExp);
  const result = divideAndRound(numerator, denominator, rounding);

  const limit = BigInt(MAX_ABS_AMOUNT_MINOR);
  if (result > limit || result < -limit) throw new AmountOutOfRangeError(result);
  const amountMinor = Number(result);
  return { amountMinor: amountMinor === 0 ? 0 : amountMinor, currency: target };
}

/** Converts using a full ExchangeRate record, validating its direction. */
export function convertWithRate(amount: Money, rate: ExchangeRate, rounding?: RoundingMode): Money {
  if (rate.base !== amount.currency) {
    throw new InvalidExchangeRateError(
      `Rate base ${rate.base} does not match amount currency ${amount.currency}`,
    );
  }
  return convert(amount, rate.rate, rate.quote, rounding);
}

/**
 * Snapshot of how an amount was converted into the user's base currency at the
 * time it was recorded. Stored alongside every transaction so the original
 * amount is never overwritten and history stays reproducible even if the base
 * currency later changes.
 */
export interface BaseCurrencySnapshot {
  baseCurrency: CurrencyCode;
  baseAmountMinor: number;
  /** Rate from the original currency to the base currency. "1" when equal. */
  baseFxRate: DecimalString;
  baseFxRateDate: string;
  baseFxSource: string;
}

export function createBaseCurrencySnapshot(
  original: Money,
  baseCurrency: CurrencyCode,
  rate: Pick<ExchangeRate, 'rate' | 'rateDate' | 'source'> | null,
  onDate: string,
): BaseCurrencySnapshot {
  if (original.currency === baseCurrency) {
    return {
      baseCurrency,
      baseAmountMinor: original.amountMinor,
      baseFxRate: '1',
      baseFxRateDate: onDate,
      baseFxSource: 'identity',
    };
  }
  if (!rate) {
    throw new InvalidExchangeRateError(
      `An exchange rate ${original.currency}→${baseCurrency} is required`,
    );
  }
  const converted = convert(original, rate.rate, baseCurrency);
  return {
    baseCurrency,
    baseAmountMinor: converted.amountMinor,
    baseFxRate: rate.rate,
    baseFxRateDate: rate.rateDate,
    baseFxSource: rate.source,
  };
}

/**
 * Exact inverse of a rate (1 / rate), rounded to `scale` decimals. Used when
 * only the opposite quote is stored (EUR→USD known, USD→EUR needed).
 */
export function invertRate(rate: DecimalString, scale = 12): DecimalString {
  if (!isDecimalString(rate)) throw new InvalidExchangeRateError(`Invalid rate "${rate}"`);
  const { coefficient, scale: rateScale } = parseDecimal(rate);
  if (coefficient <= 0n) throw new InvalidExchangeRateError('Exchange rate must be positive');
  // 1 / (c / 10^s) = 10^s / c ; scaled by 10^scale
  const inverted = divideAndRound(pow10(rateScale + scale), coefficient);
  const digits = inverted.toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
