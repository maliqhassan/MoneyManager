import {
  createBaseCurrencySnapshot,
  convert,
  convertWithRate,
  InvalidExchangeRateError,
} from '../conversion';
import {
  divideAndRound,
  formatDecimal,
  InvalidDecimalError,
  isDecimalString,
  parseDecimal,
  pow10,
} from '../decimal';
import { AmountOutOfRangeError, money } from '../money';
import { parseMoneyInput } from '../parse';

describe('decimal', () => {
  it('parses and formats exactly', () => {
    expect(parseDecimal('1.0834')).toEqual({ coefficient: 10834n, scale: 4 });
    expect(parseDecimal('-0.5')).toEqual({ coefficient: -5n, scale: 1 });
    expect(formatDecimal({ coefficient: 10834n, scale: 4 })).toBe('1.0834');
    expect(formatDecimal({ coefficient: -5n, scale: 3 })).toBe('-0.005');
    expect(formatDecimal({ coefficient: 42n, scale: 0 })).toBe('42');
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'abc', '1e5', '1.', '.5', '1,5', 'NaN', '1.2.3']) {
      expect(isDecimalString(bad)).toBe(false);
    }
    expect(() => parseDecimal('1e5')).toThrow(InvalidDecimalError);
    expect(isDecimalString(`1.${'1'.repeat(19)}`)).toBe(false);
  });

  it('rounds with every mode', () => {
    expect(divideAndRound(5n, 2n)).toBe(3n); // 2.5
    expect(divideAndRound(-5n, 2n)).toBe(-3n);
    expect(divideAndRound(5n, 2n, 'half-even')).toBe(2n);
    expect(divideAndRound(7n, 2n, 'half-even')).toBe(4n);
    expect(divideAndRound(7n, 4n, 'half-even')).toBe(2n); // 1.75
    expect(divideAndRound(5n, 4n, 'half-even')).toBe(1n); // 1.25
    expect(divideAndRound(-7n, 2n, 'floor')).toBe(-4n);
    expect(divideAndRound(7n, 2n, 'floor')).toBe(3n);
    expect(divideAndRound(-7n, 2n, 'ceil')).toBe(-3n);
    expect(divideAndRound(7n, 2n, 'ceil')).toBe(4n);
    expect(divideAndRound(7n, 2n, 'truncate')).toBe(3n);
    expect(divideAndRound(7n, -2n)).toBe(-4n);
    expect(divideAndRound(6n, 3n)).toBe(2n);
    expect(() => divideAndRound(1n, 0n)).toThrow(RangeError);
    expect(() => pow10(-1)).toThrow(RangeError);
  });
});

describe('parseMoneyInput', () => {
  it('parses en-US style input', () => {
    expect(parseMoneyInput('1,234.56', 'USD')).toEqual({
      ok: true,
      value: { amountMinor: 123456, currency: 'USD' },
    });
    expect(parseMoneyInput('10.5', 'USD')).toMatchObject({ value: { amountMinor: 1050 } });
    expect(parseMoneyInput('.99', 'USD')).toMatchObject({ value: { amountMinor: 99 } });
    expect(parseMoneyInput('-3', 'USD')).toMatchObject({ value: { amountMinor: -300 } });
  });

  it('parses de-DE style input with NBSP grouping', () => {
    expect(parseMoneyInput('1.234,56', 'EUR', { decimal: ',', group: '.' })).toMatchObject({
      value: { amountMinor: 123456 },
    });
    expect(parseMoneyInput('1\u202F234,5', 'EUR', { decimal: ',', group: '\u202F' })).toMatchObject(
      {
        value: { amountMinor: 123450 },
      },
    );
  });

  it('respects currency minor units', () => {
    expect(parseMoneyInput('1000', 'JPY')).toMatchObject({ value: { amountMinor: 1000 } });
    expect(parseMoneyInput('1.5', 'JPY')).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(parseMoneyInput('1.255', 'KWD')).toMatchObject({ value: { amountMinor: 1255 } });
    expect(parseMoneyInput('1.999', 'USD')).toEqual({ ok: false, error: 'too_many_decimals' });
  });

  it('rejects malformed and out-of-range input', () => {
    expect(parseMoneyInput('  ', 'USD')).toEqual({ ok: false, error: 'empty' });
    expect(parseMoneyInput('12a', 'USD')).toEqual({ ok: false, error: 'invalid' });
    expect(parseMoneyInput('1.2.3', 'USD')).toEqual({ ok: false, error: 'invalid' });
    expect(parseMoneyInput('.', 'USD')).toEqual({ ok: false, error: 'invalid' });
    expect(parseMoneyInput('99999999999999999', 'USD')).toEqual({
      ok: false,
      error: 'out_of_range',
    });
  });

  it('normalises -0', () => {
    const result = parseMoneyInput('-0.00', 'USD');
    expect(result.ok && Object.is(result.value.amountMinor, 0)).toBe(true);
  });
});

describe('currency conversion', () => {
  it('converts EUR → USD exactly', () => {
    expect(convert(money(10000, 'EUR'), '1.0834', 'USD')).toEqual(money(10834, 'USD'));
  });

  it('rounds half away from zero by default', () => {
    // 0.05 EUR * 1.1 = 0.055 USD → 0.06
    expect(convert(money(5, 'EUR'), '1.1', 'USD').amountMinor).toBe(6);
    expect(convert(money(-5, 'EUR'), '1.1', 'USD').amountMinor).toBe(-6);
    expect(convert(money(5, 'EUR'), '1.1', 'USD', 'half-even').amountMinor).toBe(6);
  });

  it('handles differing minor-unit exponents', () => {
    // USD 10.00 at 151.25 JPY/USD → JPY 1513 (1512.5 rounded)
    expect(convert(money(1000, 'USD'), '151.25', 'JPY')).toEqual(money(1513, 'JPY'));
    // JPY 1000 at 0.0066 → USD 6.60
    expect(convert(money(1000, 'JPY'), '0.0066', 'USD')).toEqual(money(660, 'USD'));
    // USD 1.00 at 0.307 KWD → KWD 0.307
    expect(convert(money(100, 'USD'), '0.307', 'KWD')).toEqual(money(307, 'KWD'));
  });

  it('validates rates', () => {
    expect(() => convert(money(1, 'USD'), '0', 'EUR')).toThrow(InvalidExchangeRateError);
    expect(() => convert(money(1, 'USD'), '-1', 'EUR')).toThrow(InvalidExchangeRateError);
    expect(() => convert(money(1, 'USD'), 'abc', 'EUR')).toThrow(InvalidExchangeRateError);
    expect(() => convert(money(1, 'USD'), '1.5', 'USD')).toThrow(InvalidExchangeRateError);
    expect(convert(money(1, 'USD'), '1.000', 'USD')).toEqual(money(1, 'USD'));
  });

  it('guards against overflow', () => {
    expect(() => convert(money(1e15, 'JPY'), '1000', 'USD')).toThrow(AmountOutOfRangeError);
  });

  it('checks rate direction when using a rate record', () => {
    const rate = {
      base: 'GBP' as const,
      quote: 'USD' as const,
      rate: '1.27',
      rateDate: '2026-10-01',
      source: 'manual',
    };
    expect(convertWithRate(money(100, 'GBP'), rate)).toEqual(money(127, 'USD'));
    expect(() => convertWithRate(money(100, 'EUR'), rate)).toThrow(InvalidExchangeRateError);
  });
});

describe('base currency snapshot', () => {
  it('uses identity when currencies match', () => {
    expect(createBaseCurrencySnapshot(money(500, 'USD'), 'USD', null, '2026-10-07')).toEqual({
      baseCurrency: 'USD',
      baseAmountMinor: 500,
      baseFxRate: '1',
      baseFxRateDate: '2026-10-07',
      baseFxSource: 'identity',
    });
  });

  it('preserves the rate used for foreign amounts', () => {
    const snap = createBaseCurrencySnapshot(
      money(-2000, 'EUR'),
      'AED',
      { rate: '3.98', rateDate: '2026-10-06', source: 'ecb' },
      '2026-10-07',
    );
    expect(snap).toEqual({
      baseCurrency: 'AED',
      baseAmountMinor: -7960,
      baseFxRate: '3.98',
      baseFxRateDate: '2026-10-06',
      baseFxSource: 'ecb',
    });
  });

  it('requires a rate for foreign amounts', () => {
    expect(() => createBaseCurrencySnapshot(money(1, 'EUR'), 'USD', null, '2026-10-07')).toThrow(
      InvalidExchangeRateError,
    );
  });
});
