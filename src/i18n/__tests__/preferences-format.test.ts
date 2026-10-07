import {
  buildLocaleTag,
  formatAmountForInput,
  formatDateWithPreference,
  formatMoney,
  getCurrencySymbol,
  getNumberSeparators,
  resolveNumberLocale,
} from '../format';
import { createFormatter, type FormatSettings } from '../formatter';

// ICU uses NBSP / narrow NBSP as grouping or symbol spacing in some locales.
const n = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ');
const amount = { amountMinor: 123456, currency: 'EUR' as const };

describe('number formats', () => {
  it.each([
    ['comma_period', 'en-US', '€1,234.56'],
    ['period_comma', 'de-DE', '1.234,56 €'],
    ['space_comma', 'fr-FR', '1 234,56 €'],
  ] as const)('%s → %s', (format, locale, expected) => {
    const resolved = resolveNumberLocale(format, 'en-GB');
    expect(resolved).toBe(locale);
    expect(n(formatMoney(amount, resolved))).toBe(expected);
  });

  it('apostrophe_period → de-CH Swiss grouping', () => {
    expect(resolveNumberLocale('apostrophe_period', 'en-GB')).toBe('de-CH');
    // ICU versions differ on the symbol (EUR / €) and apostrophe glyph; grouping must not.
    expect(formatMoney(amount, 'de-CH')).toMatch(/1['’]234[.]56/);
  });

  it('"locale" follows the formatting locale', () => {
    expect(resolveNumberLocale('locale', 'en-IN')).toBe('en-IN');
    expect(formatMoney({ amountMinor: 123456789, currency: 'INR' }, 'en-IN')).toBe('₹12,34,567.89');
  });

  it('reads separators from Intl', () => {
    expect(getNumberSeparators('en-US')).toEqual({ decimal: '.', group: ',' });
    expect(getNumberSeparators('de-DE')).toEqual({ decimal: ',', group: '.' });
    expect(n(getNumberSeparators('fr-FR').group)).toBe(' ');
  });
});

describe('currency symbols', () => {
  it.each([
    ['USD', '$'],
    ['EUR', '€'],
    ['GBP', '£'],
    ['JPY', '¥'],
    ['INR', '₹'],
  ] as const)('%s → %s', (code, symbol) => {
    expect(getCurrencySymbol(code, 'en-US')).toBe(symbol);
  });

  it('falls back to the code when no symbol exists', () => {
    expect(getCurrencySymbol('AED', 'en-US')).toMatch(/AED|د\.إ/);
  });
});

describe('date formats (canonical storage, formatted at presentation)', () => {
  it.each([
    ['MDY', '01/31/2026'],
    ['DMY', '31/01/2026'],
    ['YMD', '2026-01-31'],
  ] as const)('%s', (format, expected) => {
    expect(formatDateWithPreference('2026-01-31', 'en-US', format)).toBe(expected);
  });

  it('"locale" uses the locale numeric order', () => {
    expect(formatDateWithPreference('2026-01-31', 'en-US', 'locale')).toBe('01/31/2026');
    expect(formatDateWithPreference('2026-01-31', 'en-GB', 'locale')).toBe('31/01/2026');
    expect(formatDateWithPreference('2026-01-31', 'de-DE', 'locale')).toBe('31.01.2026');
  });

  it('medium style uses month names', () => {
    expect(formatDateWithPreference('2026-01-31', 'en-US', 'DMY', 'medium')).toBe('Jan 31, 2026');
  });
});

describe('helpers', () => {
  it('builds canonical locale tags', () => {
    expect(buildLocaleTag('en', 'GB')).toBe('en-GB');
    expect(buildLocaleTag('en', null)).toBe('en');
    expect(buildLocaleTag('!!', 'GB')).toBe('en-US');
  });

  it('formats amounts for editing without grouping', () => {
    expect(
      formatAmountForInput({ amountMinor: 123456, currency: 'USD' }, { decimal: '.', group: ',' }),
    ).toBe('1234.56');
    expect(
      formatAmountForInput({ amountMinor: -5, currency: 'EUR' }, { decimal: ',', group: '.' }),
    ).toBe('-0,05');
    expect(
      formatAmountForInput({ amountMinor: 1500, currency: 'JPY' }, { decimal: '.', group: ',' }),
    ).toBe('1500');
  });
});

describe('createFormatter', () => {
  const settings: FormatSettings = {
    locale: 'en-GB',
    language: 'en',
    region: 'GB',
    numberFormat: 'period_comma',
    dateFormat: 'YMD',
    timeZone: 'Asia/Tokyo',
    firstDayOfWeek: 1,
    baseCurrency: 'GBP',
  };

  it('applies number, date and time-zone preferences together', () => {
    const f = createFormatter(settings);
    expect(f.numberLocale).toBe('de-DE');
    expect(f.separators.decimal).toBe(',');
    expect(n(f.money({ amountMinor: 123456, currency: 'GBP' }))).toBe('1.234,56 £');
    expect(f.date('2026-03-09')).toBe('2026-03-09');
    expect(f.today(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
    expect(f.amountForInput({ amountMinor: 85050, currency: 'GBP' })).toBe('850,50');
  });
});
