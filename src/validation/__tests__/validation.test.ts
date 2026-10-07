import { accountInputSchema, accountUpdateSchema } from '../entities';
import {
  calendarDateSchema,
  currencyCodeSchema,
  emailSchema,
  exchangeRateSchema,
  ianaTimeZoneSchema,
  passwordSchema,
} from '../common';

describe('common schemas', () => {
  it('validates currency codes against ISO 4217 table', () => {
    expect(currencyCodeSchema.safeParse('AED').success).toBe(true);
    expect(currencyCodeSchema.safeParse('usd').success).toBe(false);
    expect(currencyCodeSchema.safeParse('XYZ').success).toBe(false);
  });

  it('validates real calendar dates', () => {
    expect(calendarDateSchema.safeParse('2028-02-29').success).toBe(true);
    expect(calendarDateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(calendarDateSchema.safeParse('2026-10-07T00:00:00Z').success).toBe(false);
  });

  it('validates exchange rates as positive exact decimals', () => {
    expect(exchangeRateSchema.safeParse('1.0834').success).toBe(true);
    expect(exchangeRateSchema.safeParse('0').success).toBe(false);
    expect(exchangeRateSchema.safeParse('0.000').success).toBe(false);
    expect(exchangeRateSchema.safeParse('-1').success).toBe(false);
    expect(exchangeRateSchema.safeParse('1e3').success).toBe(false);
  });

  it('normalises emails and enforces password length', () => {
    expect(emailSchema.parse('  User@Example.COM ')).toBe('user@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(73)).success).toBe(false);
    expect(passwordSchema.safeParse('long enough pw').success).toBe(true);
  });

  it('validates IANA time zones', () => {
    expect(ianaTimeZoneSchema.safeParse('Asia/Dubai').success).toBe(true);
    expect(ianaTimeZoneSchema.safeParse('Mars/Olympus').success).toBe(false);
  });
});

describe('account schemas', () => {
  const valid = {
    name: ' Savings ',
    type: 'savings',
    currency: 'EUR',
    openingBalanceMinor: 0,
    openingBalanceDate: '2026-10-01',
  };

  it('applies defaults on create and trims text', () => {
    expect(accountInputSchema.parse({ ...valid, institution: '   ' })).toMatchObject({
      name: 'Savings',
      institution: null,
      includeInTotals: true,
      creditLimitMinor: null,
      sortOrder: 0,
    });
  });

  it('rejects malformed values', () => {
    const result = accountInputSchema.safeParse({
      ...valid,
      type: 'crypto',
      openingBalanceMinor: 1e16,
      color: 'red',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual([
      'color',
      'openingBalanceMinor',
      'type',
    ]);
  });

  it('never injects defaults into partial updates (Zod 4 regression guard)', () => {
    expect(accountUpdateSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('strips currency from updates', () => {
    expect(accountUpdateSchema.parse({ currency: 'USD' })).toEqual({});
  });
});
