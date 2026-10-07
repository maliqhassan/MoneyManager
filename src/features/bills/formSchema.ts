import { z } from 'zod';

import type { CurrencyCode } from '@/domain/currency/currencies';
import { compareDates } from '@/domain/dates/calendar';
import { RECURRENCE_FREQUENCIES, type RecurrenceFrequency } from '@/domain/enums';
import type { Bill } from '@/domain/models';
import {
  MAX_RECURRENCE_INTERVAL,
  PRESET_RECURRENCE,
  presetOf,
  RECURRENCE_PRESETS,
  type RecurrencePreset,
} from '@/domain/planning/recurrence';
import { parsePositiveAmount } from '@/features/transactions/formSchema';
import { currencyFieldSchema, nameSchema } from '@/validation/common';
import type { BillInput } from '@/validation/planning';

/** Offered reminder choices; a stored value outside these is kept as its own choice. */
export const REMINDER_CHOICES = ['none', '0', '1', '3', '7'] as const;
/** 'none' or whole days before the due date (0–60). */
export type ReminderChoice = string;

export interface BillFormValues {
  name: string;
  isSubscription: boolean;
  amount: string;
  isVariableAmount: boolean;
  currency: CurrencyCode;
  accountId: string | null;
  categoryId: string | null;
  preset: RecurrencePreset | 'custom';
  frequency: RecurrenceFrequency;
  interval: string;
  nextDueDate: string;
  hasEnd: boolean;
  endDate: string | null;
  reminder: ReminderChoice;
  autopay: boolean;
  notes: string;
}

/** Whole number 1–365 from text; null when invalid. */
export function parseInterval(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 1 && n <= MAX_RECURRENCE_INTERVAL ? n : null;
}

export function recurrenceOf(values: Pick<BillFormValues, 'preset' | 'frequency' | 'interval'>) {
  if (values.preset !== 'custom') return PRESET_RECURRENCE[values.preset];
  return { frequency: values.frequency, interval: parseInterval(values.interval) ?? 1 };
}

export function createBillFormSchema(decimal: string) {
  return z
    .object({
      name: nameSchema,
      isSubscription: z.boolean(),
      amount: z.string(),
      isVariableAmount: z.boolean(),
      currency: currencyFieldSchema,
      accountId: z.string().nullable(),
      categoryId: z.string().nullable(),
      preset: z.enum([...RECURRENCE_PRESETS, 'custom']),
      frequency: z.enum(RECURRENCE_FREQUENCIES),
      interval: z.string(),
      nextDueDate: z.string(),
      hasEnd: z.boolean(),
      endDate: z.string().nullable(),
      reminder: z.string().regex(/^(none|\d{1,2})$/, { message: 'bills.errors.reminder' }),
      autopay: z.boolean(),
      notes: z.string().max(1000, { message: 'validation.tooLong' }),
    })
    .superRefine((v, ctx) => {
      const amount = parsePositiveAmount(v.amount, v.currency, decimal);
      if (!amount.ok) ctx.addIssue({ code: 'custom', path: ['amount'], message: amount.error });
      if (v.preset === 'custom' && parseInterval(v.interval) === null) {
        ctx.addIssue({ code: 'custom', path: ['interval'], message: 'bills.errors.interval' });
      }
      if (v.hasEnd && v.endDate && compareDates(v.endDate, v.nextDueDate) < 0) {
        ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'bills.errors.endBeforeDue' });
      }
    });
}

export function toBillInput(values: BillFormValues, decimal: string): BillInput {
  const amount = parsePositiveAmount(values.amount, values.currency, decimal);
  /* istanbul ignore next -- the form schema rejects unparsable amounts first */
  if (!amount.ok) throw new Error(amount.error);
  const recurrence = recurrenceOf(values);
  return {
    name: values.name.trim(),
    isSubscription: values.isSubscription,
    amountMinor: amount.minor,
    isVariableAmount: values.isVariableAmount,
    currency: values.currency,
    accountId: values.accountId,
    categoryId: values.categoryId,
    frequency: recurrence.frequency,
    interval: recurrence.interval,
    nextDueDate: values.nextDueDate,
    endDate: values.hasEnd ? values.endDate : null,
    reminderDaysBefore: values.reminder === 'none' ? null : Number(values.reminder),
    autopay: values.autopay,
    notes: values.notes,
  };
}

export function billFormValues(bill: Bill, amountText: string): BillFormValues {
  const preset = presetOf(bill);
  return {
    name: bill.name,
    isSubscription: bill.isSubscription,
    amount: amountText,
    isVariableAmount: bill.isVariableAmount,
    currency: bill.currency,
    accountId: bill.accountId,
    categoryId: bill.categoryId,
    preset,
    frequency: bill.frequency,
    interval: String(bill.interval),
    nextDueDate: bill.nextDueDate,
    hasEnd: bill.endDate !== null,
    endDate: bill.endDate,
    reminder: bill.reminderDaysBefore === null ? 'none' : String(bill.reminderDaysBefore),
    autopay: bill.autopay,
    notes: bill.notes ?? '',
  };
}
