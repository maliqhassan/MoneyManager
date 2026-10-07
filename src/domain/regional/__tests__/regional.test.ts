import {
  CURRENCIES,
  CURRENCY_CODES,
  isCurrencyCode,
  POPULAR_CURRENCIES,
  searchCurrencies,
} from '../../currency/currencies';
import { COUNTRIES, findCountry, searchCountries } from '../countries';
import {
  COMMON_TIME_ZONES,
  formatUtcOffset,
  getUtcOffsetMinutes,
  isValidTimeZone,
  listTimeZones,
  timeZoneCity,
} from '../timeZones';

const REQUIRED = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'CHF',
  'JPY',
  'CNY',
  'HKD',
  'SGD',
  'INR',
  'AED',
  'SAR',
  'PKR',
  'ZAR',
  'BRL',
  'MXN',
  'NOK',
  'SEK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'TRY',
  'ILS',
  'KRW',
];

describe('currency catalog', () => {
  it('contains every required currency', () => {
    for (const code of REQUIRED) expect(isCurrencyCode(code)).toBe(true);
    expect(CURRENCY_CODES.length).toBeGreaterThanOrEqual(90);
  });

  it('uses valid ISO-4217 shapes and exponents', () => {
    for (const code of CURRENCY_CODES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect([0, 2, 3]).toContain(CURRENCIES[code].minorUnits);
      expect(CURRENCIES[code].name.length).toBeGreaterThan(2);
    }
    expect(CURRENCIES.JPY.minorUnits).toBe(0);
    expect(CURRENCIES.KRW.minorUnits).toBe(0);
    expect(CURRENCIES.KWD.minorUnits).toBe(3);
  });

  it('searches by code and name with popular currencies first', () => {
    expect(searchCurrencies('').slice(0, POPULAR_CURRENCIES.length)).toEqual(POPULAR_CURRENCIES);
    expect(searchCurrencies('rupee')).toEqual(expect.arrayContaining(['INR', 'PKR', 'LKR']));
    expect(searchCurrencies('eur')).toContain('EUR');
    expect(searchCurrencies('zzz')).toEqual([]);
  });
});

describe('countries', () => {
  it('have unique codes, valid currencies and canonical locales', () => {
    const codes = new Set<string>();
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(codes.has(c.code)).toBe(false);
      codes.add(c.code);
      expect(isCurrencyCode(c.currency)).toBe(true);
      expect(Intl.getCanonicalLocales(c.locale)[0]).toBe(c.locale);
    }
    for (const code of ['US', 'CA', 'GB', 'DE', 'FR', 'AU', 'AE', 'IN', 'PK']) {
      expect(findCountry(code)).not.toBeNull();
    }
  });

  it('finds and searches countries', () => {
    expect(findCountry('ae')?.currency).toBe('AED');
    expect(findCountry(null)).toBeNull();
    expect(findCountry('XX')).toBeNull();
    expect(searchCountries('united').map((c) => c.code)).toEqual(
      expect.arrayContaining(['AE', 'GB', 'US']),
    );
    expect(searchCountries('pk').map((c) => c.code)).toEqual(['PK']);
  });
});

describe('time zones', () => {
  it('lists only valid IANA zones', () => {
    for (const tz of COMMON_TIME_ZONES) expect(isValidTimeZone(tz)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('computes offsets including half/quarter hours and DST', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    const summer = new Date('2026-07-15T12:00:00Z');
    expect(getUtcOffsetMinutes('Asia/Kolkata', winter)).toBe(330);
    expect(getUtcOffsetMinutes('Asia/Kathmandu', winter)).toBe(345);
    expect(getUtcOffsetMinutes('America/New_York', winter)).toBe(-300);
    expect(getUtcOffsetMinutes('America/New_York', summer)).toBe(-240);
    expect(getUtcOffsetMinutes('Australia/Sydney', winter)).toBe(660);
    expect(getUtcOffsetMinutes('UTC', summer)).toBe(0);
  });

  it('formats offsets and city names', () => {
    expect(formatUtcOffset(330)).toBe('UTC+05:30');
    expect(formatUtcOffset(-240)).toBe('UTC-04:00');
    expect(formatUtcOffset(0)).toBe('UTC');
    expect(timeZoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
  });

  it('includes extra (device) zones, de-duplicated and ordered by offset', () => {
    const at = new Date('2026-01-15T12:00:00Z');
    const list = listTimeZones(['Asia/Karachi', 'Invalid/Zone', 'Asia/Dubai'], at);
    expect(list).toContain('Asia/Karachi');
    expect(list).not.toContain('Invalid/Zone');
    expect(new Set(list).size).toBe(list.length);
    const offsets = list.map((tz) => getUtcOffsetMinutes(tz, at));
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });
});
