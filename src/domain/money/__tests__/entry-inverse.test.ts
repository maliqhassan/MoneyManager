import { convert, invertRate, InvalidExchangeRateError } from '../conversion';
import { parseAmountEntry } from '../parse';

const minor = (input: string, currency: 'USD' | 'EUR' | 'JPY' | 'KWD' = 'USD', decimal = '.') => {
  const r = parseAmountEntry(input, currency, decimal);
  return r.ok ? r.value.amountMinor : r.error;
};

describe('parseAmountEntry (keyboard-tolerant)', () => {
  it('accepts the preferred decimal separator', () => {
    expect(minor('12.50')).toBe(1250);
    expect(minor('12,50', 'EUR', ',')).toBe(1250);
  });

  it('infers a comma decimal on an en-US profile (German keyboard)', () => {
    expect(minor('12,50')).toBe(1250); // not 125 000
    expect(minor('0,5')).toBe(50);
  });

  it('treats a single 3-digit group as thousands', () => {
    expect(minor('1,250')).toBe(125_000);
    expect(minor('1.250', 'EUR', ',')).toBe(125_000);
  });

  it('uses the last separator as decimal when both appear', () => {
    expect(minor('1,234.56')).toBe(123_456);
    expect(minor('1.234,56')).toBe(123_456);
    expect(minor('1.234.567,89', 'EUR', ',')).toBe(123_456_789);
  });

  it('treats repeated separators as grouping', () => {
    expect(minor('1,234,567')).toBe(123_456_700);
    expect(minor('1.234.567', 'EUR', ',')).toBe(123_456_700);
  });

  it('ignores spaces and Swiss apostrophes, keeps signs', () => {
    expect(minor("1'234.50")).toBe(123_450);
    expect(minor('1 234,50', 'EUR', ',')).toBe(123_450);
    expect(minor('-850.50')).toBe(-85_050);
  });

  it('respects currency exponents and rejects junk', () => {
    expect(minor('1500', 'JPY')).toBe(1500);
    expect(minor('1.5', 'JPY')).toBe('too_many_decimals');
    expect(minor('1.250', 'KWD')).toBe(1250);
    expect(minor('12.345')).toBe('too_many_decimals');
    expect(minor('abc')).toBe('invalid');
    expect(minor('NaN')).toBe('invalid');
    expect(minor('')).toBe('empty');
    expect(minor('1e5')).toBe('invalid');
  });
});

describe('invertRate', () => {
  it('inverts exactly to 12 decimals', () => {
    expect(invertRate('2')).toBe('0.5');
    expect(invertRate('1.25')).toBe('0.8');
    expect(invertRate('3.6725')).toBe('0.272294077604');
    expect(invertRate('0.0066')).toBe('151.515151515152');
  });

  it('round-trips through conversion within a minor unit', () => {
    const eurToUsd = '1.0834';
    const usdToEur = invertRate(eurToUsd);
    const usd = convert({ amountMinor: 100_000, currency: 'EUR' }, eurToUsd, 'USD');
    const back = convert(usd, usdToEur, 'EUR');
    expect(Math.abs(back.amountMinor - 100_000)).toBeLessThanOrEqual(1);
  });

  it('rejects invalid rates', () => {
    expect(() => invertRate('0')).toThrow(InvalidExchangeRateError);
    expect(() => invertRate('abc')).toThrow(InvalidExchangeRateError);
  });
});
