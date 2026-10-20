import { z } from 'zod';

import { compareDates } from '@/domain/dates/calendar';
import { RECURRENCE_FREQUENCIES } from '@/domain/enums';
import { MAX_RECURRENCE_INTERVAL } from '@/domain/planning/recurrence';

import { calendarDateSchema, optionalTextSchema, positiveAmountMinorSchema } from './common';
import { tagNameSchema } from './transactions';

const idSchema = z.string().trim().min(1, { message: 'validation.required' });

/**
 * A recurring income or expense. The currency is the account's (checked by
 * the repository); the start date is the schedule's anchor.
 */
export const recurringRuleInputSchema = z
  .object({
    type: z.enum(['expense', 'income']),
    accountId: idSchema,
    categoryId: idSchema,
    amountMinor: positiveAmountMinorSchema,
    payee: optionalTextSchema(200).default(null),
    notes: optionalTextSchema(1000).default(null),
    tagNames: z.array(tagNameSchema).max(20).default([]),
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z
      .number()
      .int({ message: 'recurring.errors.interval' })
      .min(1, { message: 'recurring.errors.interval' })
      .max(MAX_RECURRENCE_INTERVAL, { message: 'recurring.errors.interval' }),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema.nullable().default(null),
    /** false (default): occurrences wait for the user to confirm them. */
    autoPost: z.boolean().default(false),
    reminderDaysBefore: z
      .number()
      .int()
      .min(0, { message: 'recurring.errors.reminder' })
      .max(30, { message: 'recurring.errors.reminder' })
      .nullable()
      .default(null),
    timeZone: z.string().trim().min(1).max(64),
  })
  .refine((v) => !v.endDate || compareDates(v.endDate, v.startDate) >= 0, {
    path: ['endDate'],
    message: 'recurring.errors.endBeforeStart',
  });

export type RecurringRuleInput = z.input<typeof recurringRuleInputSchema>;
export type ValidRecurringRuleInput = z.output<typeof recurringRuleInputSchema>;
