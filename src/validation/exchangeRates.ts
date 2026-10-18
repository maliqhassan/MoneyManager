import { z } from 'zod';

import { compareDates, isCalendarDate } from '@/domain/dates/calendar';
import { InvalidRateError, validateRate } from '@/domain/fx/rateMath';

import { calendarDateSchema, currencyCodeSchema } from './common';

/**
 * A user-entered exchange rate: 1 `base` = `rate` `quote`, effective from
 * `rateDate`. `today` is the user's local date (future rates are rejected).
 */
export const manualRateSchema = (today: string) =>
  z
    .object({
      base: currencyCodeSchema,
      quote: currencyCodeSchema,
      rateDate: calendarDateSchema,
      rate: z.string().transform((value, ctx) => {
        try {
          return validateRate(value);
        } catch (e) {
          const reason = e instanceof InvalidRateError ? e.reason : 'format';
          ctx.addIssue({
            code: 'custom',
            message:
              reason === 'precision'
                ? 'validation.ratePrecision'
                : reason === 'range'
                  ? 'validation.rateRange'
                  : 'validation.invalidRate',
          });
          return z.NEVER;
        }
      }),
    })
    .superRefine((v, ctx) => {
      if (v.base === v.quote) {
        ctx.addIssue({ code: 'custom', path: ['quote'], message: 'validation.sameCurrency' });
      }
      if (isCalendarDate(v.rateDate) && compareDates(v.rateDate, today) > 0) {
        ctx.addIssue({ code: 'custom', path: ['rateDate'], message: 'validation.dateInFuture' });
      }
    });

export type ManualRateInput = z.input<ReturnType<typeof manualRateSchema>>;
export type ValidManualRate = z.output<ReturnType<typeof manualRateSchema>>;
