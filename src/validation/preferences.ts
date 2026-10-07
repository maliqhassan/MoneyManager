import { z } from 'zod';

import { DATE_FORMATS, NUMBER_FORMATS } from '@/domain/enums';

import { currencyCodeSchema, ianaTimeZoneSchema, isoTimestampSchema } from './common';

/** BCP-47 tag such as "en", "en-GB", "zh-Hant-TW". */
export const localeTagSchema = z
  .string()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, { message: 'validation.invalidLocale' });

export const regionCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, { message: 'validation.invalidRegion' });

/**
 * Partial update of user_preferences. No defaults here (Zod 4 would inject
 * them into partial updates — see validation/entities.ts).
 */
export const preferencesUpdateSchema = z
  .object({
    baseCurrency: currencyCodeSchema,
    locale: localeTagSchema,
    language: localeTagSchema,
    region: regionCodeSchema.nullable(),
    timeZone: ianaTimeZoneSchema,
    firstDayOfWeek: z.number().int().min(0).max(6),
    monthStartDay: z.number().int().min(1).max(28),
    dateFormat: z.enum(DATE_FORMATS),
    numberFormat: z.enum(NUMBER_FORMATS),
    onboardingCompletedAt: isoTimestampSchema.nullable(),
  })
  .partial();

export type PreferencesUpdate = z.input<typeof preferencesUpdateSchema>;
