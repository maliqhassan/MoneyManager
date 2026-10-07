import { z } from 'zod';

import { isCurrencyCode } from '@/domain/currency/currencies';
import type { CurrencyCode } from '@/domain/currency/currencies';
import { isCalendarDate } from '@/domain/dates/calendar';
import { isDecimalString } from '@/domain/money/decimal';
import { isValidAmountMinor } from '@/domain/money/money';

/**
 * Reusable field schemas. Error messages are i18n keys (resolved in the UI via
 * `t(message)`), so validation stays language-independent.
 */

export const uuidSchema = z.uuid({ message: 'validation.invalidId' });

export const currencyCodeSchema = z
  .string()
  .refine((v): v is CurrencyCode => isCurrencyCode(v), { message: 'validation.invalidCurrency' })
  .transform((v) => v as CurrencyCode);

/** Signed integer minor units within the supported range. */
export const amountMinorSchema = z
  .number({ message: 'validation.invalidAmount' })
  .refine(isValidAmountMinor, { message: 'validation.invalidAmount' });

export const positiveAmountMinorSchema = amountMinorSchema.refine((v) => v > 0, {
  message: 'validation.amountMustBePositive',
});

export const nonNegativeAmountMinorSchema = amountMinorSchema.refine((v) => v >= 0, {
  message: 'validation.amountMustNotBeNegative',
});

/** Calendar date "YYYY-MM-DD" that actually exists (rejects 2026-02-30). */
export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, { message: 'validation.invalidDate' });

export const isoTimestampSchema = z.iso.datetime({
  offset: true,
  message: 'validation.invalidDate',
});

/** Exact decimal exchange rate, strictly positive. */
export const exchangeRateSchema = z
  .string()
  .refine((v) => isDecimalString(v) && !v.startsWith('-') && /[1-9]/.test(v), {
    message: 'validation.invalidRate',
  });

export const nameSchema = z
  .string()
  .trim()
  .min(1, { message: 'validation.required' })
  .max(100, { message: 'validation.tooLong' });

export const optionalTextSchema = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, { message: 'validation.tooLong' })
    .transform((v) => (v.length === 0 ? null : v))
    .nullable();

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, { message: 'validation.invalidColor' });

export const ianaTimeZoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'validation.invalidTimeZone' },
);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'validation.invalidEmail' }));

/**
 * Password policy. 72 is the bcrypt input limit used by Supabase Auth.
 * Strength rules beyond length are enforced server-side via Supabase settings.
 */
export const passwordSchema = z
  .string()
  .min(8, { message: 'validation.passwordTooShort' })
  .max(72, { message: 'validation.passwordTooLong' });
