import { z } from 'zod';

import type { CurrencyCode } from '@/domain/currency/currencies';
import { compareDates } from '@/domain/dates/calendar';
import { RECURRENCE_FREQUENCIES, type RecurrenceFrequency } from '@/domain/enums';
import type { RecurringTransaction } from '@/domain/models';
import {
  RULE_SCHEDULE_RECURRENCE,
  RULE_SCHEDULES,
  type RuleSchedule,
  scheduleOf,
} from '@/domain/planning/recurring';
import { parseInterval } from '@/features/bills/formSchema';
import { parsePositiveAmount } from '@/features/transactions/formSchema';
import type { RecurringRuleInput } from '@/validation/recurring';

export const RULE_REMINDER_CHOICES = ['none', '0', '1', '2', '3', '7'] as const;

export interface RecurringFormValues {
  type: 'expense' | 'income';
  amount: string;
  accountId: string;
  categoryId: string | null;
  payee: string;
  notes: string;
  tagNames: string[];
  schedule: RuleSchedule | 'custom';
  frequency: RecurrenceFrequency;
  interval: string;
  startDate: string;
  hasEnd: boolean;
  endDate: string | null;
  autoPost: boolean;
  reminder: string;
}

export function recurrenceOf(v: Pick<RecurringFormValues, 'schedule' | 'frequency' | 'interval'>) {
  if (v.schedule !== 'custom') return RULE_SCHEDULE_RECURRENCE[v.schedule];
  return { frequency: v.frequency, interval: parseInterval(v.interval) ?? 1 };
}

export function createRecurringFormSchema(
  currencyOf: (accountId: string) => CurrencyCode | null,
  decimal: string,
) {
  return z
    .object({
      type: z.enum(['expense', 'income']),
      amount: z.string(),
      accountId: z.string().min(1, { message: 'recurring.errors.accountNotFound' }),
      categoryId: z.string().nullable(),
      payee: z.string().max(200, { message: 'validation.tooLong' }),
      notes: z.string().max(1000, { message: 'validation.tooLong' }),
      tagNames: z.array(z.string()),
      schedule: z.enum([...RULE_SCHEDULES, 'custom']),
      frequency: z.enum(RECURRENCE_FREQUENCIES),
      interval: z.string(),
      startDate: z.string(),
      hasEnd: z.boolean(),
      endDate: z.string().nullable(),
      autoPost: z.boolean(),
      reminder: z.string().regex(/^(none|\d{1,2})$/, { message: 'recurring.errors.reminder' }),
    })
    .superRefine((v, ctx) => {
      const currency = currencyOf(v.accountId);
      if (currency) {
        const amount = parsePositiveAmount(v.amount, currency, decimal);
        if (!amount.ok) ctx.addIssue({ code: 'custom', path: ['amount'], message: amount.error });
      }
      if (!v.categoryId) {
        ctx.addIssue({
          code: 'custom',
          path: ['categoryId'],
          message: 'recurring.errors.categoryNotFound',
        });
      }
      if (v.schedule === 'custom' && parseInterval(v.interval) === null) {
        ctx.addIssue({ code: 'custom', path: ['interval'], message: 'recurring.errors.interval' });
      }
      if (v.hasEnd && v.endDate && compareDates(v.endDate, v.startDate) < 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: 'recurring.errors.endBeforeStart',
        });
      }
    });
}

export function toRecurringInput(
  v: RecurringFormValues,
  currency: CurrencyCode,
  decimal: string,
  timeZone: string,
): RecurringRuleInput {
  const amount = parsePositiveAmount(v.amount, currency, decimal);
  /* istanbul ignore next -- the form schema rejects unparsable amounts first */
  if (!amount.ok) throw new Error(amount.error);
  const r = recurrenceOf(v);
  return {
    type: v.type,
    accountId: v.accountId,
    categoryId: v.categoryId ?? '',
    amountMinor: amount.minor,
    payee: v.payee,
    notes: v.notes,
    tagNames: v.tagNames,
    frequency: r.frequency,
    interval: r.interval,
    startDate: v.startDate,
    endDate: v.hasEnd ? v.endDate : null,
    autoPost: v.autoPost,
    reminderDaysBefore: v.reminder === 'none' ? null : Number(v.reminder),
    timeZone,
  };
}

export function recurringFormValues(
  rule: RecurringTransaction,
  amountText: string,
): RecurringFormValues {
  return {
    type: rule.type === 'income' ? 'income' : 'expense',
    amount: amountText,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    payee: rule.payee ?? '',
    notes: rule.notes ?? '',
    tagNames: rule.tagNames,
    schedule: scheduleOf(rule),
    frequency: rule.frequency,
    interval: String(rule.interval),
    startDate: rule.startDate,
    hasEnd: rule.endDate !== null,
    endDate: rule.endDate,
    autoPost: rule.autoPost,
    reminder: rule.reminderDaysBefore === null ? 'none' : String(rule.reminderDaysBefore),
  };
}
