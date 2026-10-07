import { formatBasisPoints, formatCalendarDate, formatMoney } from '../format';

// Normalise narrow/regular no-break spaces that ICU inserts between symbol and number.
const n = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ');

describe('formatMoney', () => {
  it('formats common locales', () => {
    expect(formatMoney({ amountMinor: 123456, currency: 'USD' }, 'en-US')).toBe('$1,234.56');
    expect(n(formatMoney({ amountMinor: 123456, currency: 'EUR' }, 'de-DE'))).toBe('1.234,56 €');
    expect(formatMoney({ amountMinor: 123456789, currency: 'INR' }, 'en-IN')).toBe('₹12,34,567.89');
    expect(formatMoney({ amountMinor: 1000, currency: 'JPY' }, 'ja-JP')).toMatch(/1,000$/);
    expect(n(formatMoney({ amountMinor: 1250, currency: 'KWD' }, 'en-US'))).toBe('KWD 1.250');
  });

  it('keeps the sign for amounts below one unit', () => {
    expect(formatMoney({ amountMinor: -5, currency: 'USD' }, 'en-US')).toBe('-$0.05');
    expect(formatMoney({ amountMinor: -123456, currency: 'GBP' }, 'en-GB')).toBe('-£1,234.56');
  });

  it('is exact at the maximum supported amount', () => {
    expect(formatMoney({ amountMinor: 999_999_999_999_999, currency: 'USD' }, 'en-US')).toBe(
      '$9,999,999,999,999.99',
    );
  });

  it('supports sign display options and compact fractions', () => {
    const plus = { amountMinor: 5, currency: 'USD' } as const;
    expect(formatMoney(plus, 'en-US', { signDisplay: 'always' })).toBe('+$0.05');
    expect(formatMoney(plus, 'en-US', { signDisplay: 'exceptZero' })).toBe('+$0.05');
    expect(
      formatMoney({ amountMinor: 0, currency: 'USD' }, 'en-US', { signDisplay: 'exceptZero' }),
    ).toBe('$0.00');
    expect(
      formatMoney({ amountMinor: 120000, currency: 'USD' }, 'en-US', { compactZeroFraction: true }),
    ).toBe('$1,200');
    expect(
      formatMoney({ amountMinor: -500, currency: 'USD' }, 'en-US', { signDisplay: 'never' }),
    ).toBe('$5.00');
  });
});

describe('other formatters', () => {
  it('formats calendar dates without time-zone drift', () => {
    expect(formatCalendarDate('2026-01-01', 'en-US')).toBe('Jan 1, 2026');
    expect(formatCalendarDate('2026-01-01', 'en-GB', 'short')).toBe('01/01/2026');
  });

  it('formats basis points as percentages', () => {
    expect(formatBasisPoints(7_250, 'en-US')).toBe('73%');
    expect(formatBasisPoints(7_250, 'en-US', 1)).toBe('72.5%');
  });
});
