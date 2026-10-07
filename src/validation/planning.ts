import { z } from 'zod';

import { compareDates } from '@/domain/dates/calendar';
import { BUDGET_PERIOD_TYPES, RECURRENCE_FREQUENCIES } from '@/domain/enums';
import { MAX_RECURRENCE_INTERVAL } from '@/domain/planning/recurrence';

import {
  calendarDateSchema,
  currencyCodeSchema,
  hexColorSchema,
  nameSchema,
  optionalTextSchema,
  positiveAmountMinorSchema,
} from './common';
import { transactionInputSchema } from './transactions';

/**
 * Write inputs for budgets, bills/subscriptions and savings goals. Amounts
 * are positive minor units. Referential rules (category kind, archived
 * accounts, currencies, history locks) are checked by repositories inside
 * the write transaction.
 */

const idSchema = z.string().trim().min(1, { message: 'validation.required' });

export const budgetInputSchema = z
  .object({
    name: nameSchema,
    /** null = overall budget (all spending). */
    categoryId: idSchema.nullable(),
    periodType: z.enum(BUDGET_PERIOD_TYPES),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema.nullable().default(null),
    currency: currencyCodeSchema,
    amountMinor: positiveAmountMinorSchema,
    rolloverEnabled: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.periodType === 'custom') {
      if (!v.endDate) {
        ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'budgets.errors.endRequired' });
      } else if (compareDates(v.endDate, v.startDate) < 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: 'budgets.errors.endBeforeStart',
        });
      }
    }
  })
  // Recurring budgets have no end date; a custom budget is a single period,
  // so rollover does not apply to it.
  .transform((v) =>
    v.periodType === 'custom' ? { ...v, rolloverEnabled: false } : { ...v, endDate: null },
  );
export type BudgetInput = z.input<typeof budgetInputSchema>;
export type ValidBudgetInput = z.output<typeof budgetInputSchema>;

export const billInputSchema = z
  .object({
    name: nameSchema,
    isSubscription: z.boolean(),
    amountMinor: positiveAmountMinorSchema,
    /** The amount varies (e.g. electricity); the stored amount is an estimate. */
    isVariableAmount: z.boolean().default(false),
    currency: currencyCodeSchema,
    accountId: idSchema.nullable().default(null),
    categoryId: idSchema.nullable().default(null),
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z
      .number()
      .int({ message: 'bills.errors.interval' })
      .min(1, { message: 'bills.errors.interval' })
      .max(MAX_RECURRENCE_INTERVAL, { message: 'bills.errors.interval' }),
    /** The next due date (also the schedule's anchor when the schedule changes). */
    nextDueDate: calendarDateSchema,
    endDate: calendarDateSchema.nullable().default(null),
    reminderDaysBefore: z
      .number()
      .int()
      .min(0, { message: 'bills.errors.reminder' })
      .max(60, { message: 'bills.errors.reminder' })
      .nullable()
      .default(null),
    autopay: z.boolean().default(false),
    notes: optionalTextSchema(1000).default(null),
  })
  .refine((v) => !v.endDate || compareDates(v.endDate, v.nextDueDate) >= 0, {
    path: ['endDate'],
    message: 'bills.errors.endBeforeDue',
  });
export type BillInput = z.input<typeof billInputSchema>;
export type ValidBillInput = z.output<typeof billInputSchema>;

/** Paying a bill creates a normal expense transaction for one due date. */
export const billPaymentInputSchema = z.object({
  dueDate: calendarDateSchema,
  transaction: transactionInputSchema,
});
export type BillPaymentInput = z.input<typeof billPaymentInputSchema>;

export const billLinkInputSchema = z.object({
  dueDate: calendarDateSchema,
  transactionId: idSchema,
});
export type BillLinkInput = z.input<typeof billLinkInputSchema>;

export const goalInputSchema = z.object({
  name: nameSchema,
  targetAmountMinor: positiveAmountMinorSchema,
  currency: currencyCodeSchema,
  targetDate: calendarDateSchema.nullable().default(null),
  accountId: idSchema.nullable().default(null),
  icon: z.string().trim().min(1).max(64).nullable().default(null),
  color: hexColorSchema.nullable().default(null),
});
export type GoalInput = z.input<typeof goalInputSchema>;
export type ValidGoalInput = z.output<typeof goalInputSchema>;

const contributionTransferSchema = z
  .object({
    fromAccountId: idSchema,
    toAccountId: idSchema,
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'validation.invalidTime' }),
    timeZone: z.string().min(1),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    path: ['toAccountId'],
    message: 'transactions.errors.sameAccount',
  });

export const contributionInputSchema = z
  .object({
    amountMinor: positiveAmountMinorSchema,
    currency: currencyCodeSchema,
    contributedOn: calendarDateSchema,
    accountId: idSchema.nullable().default(null),
    notes: optionalTextSchema(500).default(null),
    /** Link an existing transfer that moved the money… */
    transferId: idSchema.nullable().default(null),
    /** …or record that transfer now (same currency accounts). */
    newTransfer: contributionTransferSchema.nullable().default(null),
  })
  .refine((v) => !(v.transferId && v.newTransfer), {
    path: ['transferId'],
    message: 'goals.errors.oneTransfer',
  });
export type ContributionInput = z.input<typeof contributionInputSchema>;
export type ValidContributionInput = z.output<typeof contributionInputSchema>;
