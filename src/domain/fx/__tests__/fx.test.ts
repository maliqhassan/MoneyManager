import { convert } from '@/domain/money/conversion';
import { money } from '@/domain/money/money';

import {
  frankfurterUrl,
  parseFrankfurterError,
  parseFrankfurterRates,
  ProviderResponseError,
} from '../frankfurter';
import { isJsonNumber, isJsonObject, JsonNumber, JsonSyntaxError, parseJsonExact } from '../json';
import { ConversionNoteBuilder, emptyNote } from '../note';
import {
  chooseRoute,
  earliestAcceptable,
  FX_POLICY,
  isStale,
  type Route,
  type StoredRate,
} from '../policy';
import {
  deriveRate,
  InvalidRateError,
  inverseRate,
  numberLiteralToDecimal,
  validateRate,
} from '../rateMath';
import { formatRateText, parseRateInput } from '../rateText';

const row = (patch: Partial<StoredRate> = {}): StoredRate => ({
  base: 'USD',
  quote: 'EUR',
  rate: '0.9',
  rateDate: '2026-10-10',
  source: 'frankfurter',
  kind: 'provider',
  ...patch,
});

describe('rate validation and exact arithmetic', () => {
  it('accepts positive decimals and canonicalises them', () => {
    expect(validateRate('1.08340')).toBe('1.0834');
    expect(validateRate('007.5')).toBe('7.5');
    expect(validateRate(' 277.33 ')).toBe('277.33');
    expect(validateRate('25827')).toBe('25827');
  });

  it.each([
    ['0', 'non_positive'],
    ['0.000', 'non_positive'],
    ['-1.2', 'format'],
    ['1e3', 'format'],
    ['1,08', 'format'],
    ['', 'format'],
    ['NaN', 'format'],
    ['1.0000000000000000001', 'precision'],
    ['0.0000000001', 'range'],
    ['1000000001', 'range'],
  ])('rejects %p (%s)', (value, reason) => {
    expect(() => validateRate(value)).toThrow(InvalidRateError);
    try {
      validateRate(value);
    } catch (e) {
      expect((e as InvalidRateError).reason).toBe(reason);
    }
  });

  it('turns JSON number literals into exact decimals without floats', () => {
    expect(numberLiteralToDecimal('277.33')).toBe('277.33');
    expect(numberLiteralToDecimal('0.00112')).toBe('0.00112');
    expect(numberLiteralToDecimal('2.5e-7')).toBe('0.00000025');
    expect(numberLiteralToDecimal('1.25E+3')).toBe('1250');
    expect(numberLiteralToDecimal('15e0')).toBe('15');
    expect(numberLiteralToDecimal('-0.5')).toBe('-0.5');
    // A float round trip would lose these digits.
    expect(numberLiteralToDecimal('0.1000000000000000055511151231257827')).toBe(
      '0.1000000000000000055511151231257827',
    );
    expect(numberLiteralToDecimal('abc')).toBeNull();
    expect(numberLiteralToDecimal('1e999')).toBeNull();
  });

  it('inverts and crosses exactly, rounding once to 12 significant digits', () => {
    expect(inverseRate('4')).toBe('0.25');
    expect(inverseRate('3')).toBe('0.333333333333');
    expect(inverseRate('0.3093')).toBe('3.23310701584'); // 1 KWD in USD
    expect(inverseRate('277.33')).toBe('0.00360581256986'); // small values keep 12 digits
    // PKR→EUR via USD: (USD→EUR) / (USD→PKR)
    expect(
      deriveRate([
        { rate: '277.33', inverted: true },
        { rate: '0.89036', inverted: false },
      ]),
    ).toBe('0.0032104712797');
    // A single direct leg is returned as stored.
    expect(deriveRate([{ rate: '1.0834', inverted: false }])).toBe('1.0834');
    // Round half away from zero at the 12th digit: 2/3 → …667.
    expect(deriveRate([{ rate: '1.5', inverted: true }])).toBe('0.666666666667');
    // Rounding that carries into a new digit stays at 12 significant digits.
    expect(deriveRate([{ rate: '1.0000000000004', inverted: true }])).toBe('1');
    expect(() => deriveRate([])).toThrow(InvalidRateError);
  });

  it('converts amounts in every minor-unit exponent with one rounding step', () => {
    // USD (2) → JPY (0)
    expect(convert(money(1_000, 'USD'), '158.07', 'JPY')).toEqual(money(1_581, 'JPY'));
    // JPY (0) → KWD (3): ¥10,000 at 0.00195677…
    const jpyKwd = deriveRate([
      { rate: '158.07', inverted: true },
      { rate: '0.3093', inverted: false },
    ]);
    expect(jpyKwd).toBe('0.00195672803188');
    expect(convert(money(10_000, 'JPY'), jpyKwd, 'KWD')).toEqual(money(19_567, 'KWD'));
    // KWD (3) → USD (2): half away from zero (1.6165 → 1.62, −1.6165 → −1.62)
    expect(convert(money(500, 'KWD'), '3.233', 'USD')).toEqual(money(162, 'USD'));
    expect(convert(money(-500, 'KWD'), '3.233', 'USD')).toEqual(money(-162, 'USD'));
  });

  it('protects against overflow with very large amounts', () => {
    expect(() => convert(money(900_000_000_000_000, 'USD'), '25827', 'VND')).toThrow();
    // The largest amount at a normal rate stays exact (BigInt, no precision loss).
    expect(convert(money(999_999_999_999_999, 'USD'), '0.89036', 'EUR').amountMinor).toBe(
      890_359_999_999_999,
    );
  });
});

describe('exact JSON reader', () => {
  it('keeps numbers as their literal text', () => {
    const v = parseJsonExact(
      '[{"rate": 0.1, "n": -2e3, "ok": true, "x": null, "s": "a\\"b\\u00e9"}]',
    );
    expect(Array.isArray(v)).toBe(true);
    const obj = (v as unknown[])[0] as Record<string, unknown>;
    expect(obj.rate).toBeInstanceOf(JsonNumber);
    expect((obj.rate as JsonNumber).literal).toBe('0.1');
    expect((obj.n as JsonNumber).literal).toBe('-2e3');
    expect(obj.ok).toBe(true);
    expect(obj.x).toBeNull();
    expect(obj.s).toBe('a"bé');
    expect(isJsonNumber(obj.rate as JsonNumber)).toBe(true);
    expect(isJsonObject({ number: '1' })).toBe(true); // a plain object is not a number
    expect(isJsonNumber({ number: '1' })).toBe(false);
    expect(parseJsonExact(' {} ')).toEqual({});
    expect(parseJsonExact('[]')).toEqual([]);
  });

  it.each([
    '',
    '[1,]',
    '{"a" 1}',
    '[01]',
    '[1.]',
    '"\\x"',
    '"unterminated',
    '[1] x',
    'tru',
    '{"a":1,}',
    `"tab\there"`,
    '['.repeat(40) + ']'.repeat(40),
  ])('rejects invalid JSON %p', (text) => {
    expect(() => parseJsonExact(text)).toThrow(JsonSyntaxError);
  });

  it('does not let keys like __proto__ change the prototype', () => {
    const v = parseJsonExact('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
  });
});

describe('Frankfurter responses', () => {
  const options = {
    base: 'USD' as const,
    quotes: ['EUR', 'PKR', 'KWD'] as const,
    latestAllowedDate: '2026-10-20',
  };

  it('parses the live response shape into validated rows', () => {
    const text =
      '[{"date":"2026-10-18","base":"USD","quote":"KWD","rate":0.3093},' +
      '{"date":"2026-10-19","base":"USD","quote":"EUR","rate":0.89036},' +
      '{"date":"2026-10-18","base":"USD","quote":"PKR","rate":277.33},' +
      '{"date":"2026-10-18","base":"USD","quote":"XAU","rate":0.0003},' + // unknown to the app
      '{"date":"2026-10-18","base":"USD","quote":"AED","rate":3.6725}]'; // not requested
    expect(parseFrankfurterRates(text, options)).toEqual([
      { base: 'USD', quote: 'KWD', rateDate: '2026-10-18', rate: '0.3093' },
      { base: 'USD', quote: 'EUR', rateDate: '2026-10-19', rate: '0.89036' },
      { base: 'USD', quote: 'PKR', rateDate: '2026-10-18', rate: '277.33' },
    ]);
    expect(parseFrankfurterRates('[]', options)).toEqual([]);
  });

  it.each([
    ['not json', 'not JSON'],
    ['{"status":422}', 'expected an array'],
    ['[1]', 'row is not an object'],
    ['[{"date":"2026-02-30","base":"USD","quote":"EUR","rate":1}]', 'invalid date'],
    ['[{"date":"2026-12-01","base":"USD","quote":"EUR","rate":1}]', 'date in the future'],
    ['[{"date":"2026-10-01","base":"EUR","quote":"USD","rate":1}]', 'unexpected base currency'],
    ['[{"date":"2026-10-01","base":"USD","quote":"EUR","rate":"1.1"}]', 'rate is not a number'],
    ['[{"date":"2026-10-01","base":"USD","quote":"EUR","rate":0}]', 'invalid rate value'],
    ['[{"date":"2026-10-01","base":"USD","quote":"EUR","rate":-1}]', 'invalid rate value'],
    [
      '[{"date":"2026-10-01","base":"USD","quote":"EUR","rate":1},{"date":"2026-10-01","base":"USD","quote":"EUR","rate":1}]',
      'duplicate row',
    ],
  ])('rejects the whole response %#', (text, reason) => {
    expect(() => parseFrankfurterRates(text, options)).toThrow(ProviderResponseError);
    try {
      parseFrankfurterRates(text, options);
    } catch (e) {
      expect((e as ProviderResponseError).reason).toBe(reason);
    }
  });

  it('reads error messages and builds request URLs', () => {
    expect(parseFrankfurterError('{"status":422,"message":"invalid currency: ABC"}')).toBe(
      'invalid currency: ABC',
    );
    expect(parseFrankfurterError('<html>')).toBeNull();
    expect(frankfurterUrl('USD', ['PKR', 'EUR'], 'latest')).toBe(
      'https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,PKR',
    );
    expect(frankfurterUrl('USD', ['EUR'], { date: '2026-10-11' })).toBe(
      'https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR&date=2026-10-11',
    );
    expect(frankfurterUrl('USD', ['EUR'], { from: '2026-10-01', to: '2026-10-08' })).toBe(
      'https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR&from=2026-10-01&to=2026-10-08',
    );
  });
});

describe('rate policy and route choice', () => {
  const direct = (r: StoredRate): Route => ({
    derivation: 'direct',
    legs: [{ row: r, inverted: false }],
  });

  it('bounds historical lookups and flags stale current rates', () => {
    expect(earliestAcceptable('2026-10-08', 'provider', 'historical')).toBe('2026-10-01');
    expect(earliestAcceptable('2026-10-31', 'manual', 'historical')).toBe('2026-09-30');
    expect(earliestAcceptable('2026-10-08', 'provider', 'current')).toBeNull();
    expect(isStale('2026-10-16', '2026-10-19', 'provider')).toBe(false);
    expect(isStale('2026-10-15', '2026-10-19', 'provider')).toBe(true);
    expect(isStale('2026-09-18', '2026-10-19', 'manual')).toBe(false);
    expect(FX_POLICY.pivot).toBe('USD');
  });

  it('prefers the latest date, then manual over provider, then direct over derived', () => {
    const older = direct(row({ rate: '0.8', rateDate: '2026-10-09' }));
    const newer = direct(row({ rate: '0.9', rateDate: '2026-10-10' }));
    expect(chooseRoute('USD', 'EUR', [older, newer], 'historical', '2026-10-10')?.rate).toBe('0.9');

    const manual = direct(row({ rate: '0.95', source: 'manual', kind: 'manual' }));
    const pick = chooseRoute('USD', 'EUR', [newer, manual], 'historical', '2026-10-10');
    expect(pick).toMatchObject({ rate: '0.95', kind: 'manual', source: 'manual' });

    const inverse: Route = {
      derivation: 'inverse',
      legs: [{ row: row({ base: 'EUR', quote: 'USD', rate: '1.25' }), inverted: true }],
    };
    expect(chooseRoute('USD', 'EUR', [inverse, newer], 'historical', '2026-10-10')).toMatchObject({
      rate: '0.9',
      derivation: 'direct',
    });
    expect(chooseRoute('USD', 'EUR', [inverse], 'historical', '2026-10-10')).toMatchObject({
      rate: '0.8',
      derivation: 'inverse',
    });
    expect(chooseRoute('USD', 'EUR', [], 'historical', '2026-10-10')).toBeNull();
  });

  it('dates a cross rate by its older leg and marks mixed sources', () => {
    const cross: Route = {
      derivation: 'cross',
      legs: [
        { row: row({ quote: 'PKR', rate: '280', rateDate: '2026-10-08' }), inverted: true },
        {
          row: row({
            quote: 'EUR',
            rate: '0.9',
            rateDate: '2026-10-10',
            source: 'manual',
            kind: 'manual',
          }),
          inverted: false,
        },
      ],
    };
    const r = chooseRoute('PKR', 'EUR', [cross], 'current', '2026-10-19')!;
    expect(r).toMatchObject({
      rate: '0.00321428571429',
      rateDate: '2026-10-08',
      source: 'frankfurter+manual',
      kind: 'manual',
      derivation: 'cross',
      stale: false, // manual: 31 days
    });
  });
});

describe('conversion notes', () => {
  it('summarises snapshots, rates, stale and missing currencies', () => {
    const b = new ConversionNoteBuilder('USD');
    expect(b.build()).toEqual(emptyNote('USD'));
    expect(emptyNote('USD').converted).toBe(false);
    b.addSnapshot();
    const base = {
      from: 'EUR' as const,
      to: 'USD' as const,
      rate: '1.1',
      source: 'frankfurter',
      kind: 'provider' as const,
      derivation: 'direct' as const,
      stale: false,
    };
    b.addRate('EUR', { ...base, rateDate: '2026-10-05' });
    b.addRate('EUR', { ...base, rateDate: '2026-10-09', source: 'manual', kind: 'manual' });
    b.addRate('EUR', { ...base, rateDate: '2026-10-07', stale: true });
    b.addMissing('GBP');
    b.addMissing('GBP');
    const note = b.build();
    expect(note).toEqual({
      target: 'USD',
      converted: true,
      snapshotCount: 1,
      rates: [
        {
          currency: 'EUR',
          oldestRateDate: '2026-10-05',
          newestRateDate: '2026-10-09',
          sources: ['frankfurter', 'manual'],
          manual: true,
          stale: true,
        },
      ],
      missing: ['GBP'],
      stale: true,
    });
    const merged = new ConversionNoteBuilder('USD');
    merged.merge(note);
    expect(merged.build()).toEqual(note);
  });
});

describe('rate text', () => {
  const dot = { decimal: '.', group: ',' };
  const comma = { decimal: ',', group: '.' };

  it('parses what the user typed with their decimal separator', () => {
    expect(parseRateInput('310.5', dot)).toBe('310.5');
    expect(parseRateInput(' 1.08340 ', dot)).toBe('1.0834');
    expect(parseRateInput('310,5', comma)).toBe('310.5');
    expect(parseRateInput('.5', dot)).toBe('0.5');
    expect(parseRateInput('5.', dot)).toBe('5');
    expect(parseRateInput('25 827', dot)).toBe('25827');
    for (const bad of ['', '0', '1,234.5', '1.2.3', '-1', 'abc', '1e3', '1.5', '0,00000000001']) {
      expect(parseRateInput(bad, bad === '1.5' ? comma : dot)).toBeNull();
    }
  });

  it('formats exact rates with the user separators', () => {
    expect(formatRateText('1.0834', dot)).toBe('1.0834');
    expect(formatRateText('1.0834', comma)).toBe('1,0834');
    expect(formatRateText('25827', dot)).toBe('25,827');
    expect(formatRateText('1234.5', dot)).toBe('1234.5');
    expect(formatRateText('0.00321428571429', comma)).toBe('0,00321428571429');
  });
});
