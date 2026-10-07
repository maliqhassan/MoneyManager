import { z } from 'zod';

import type { CurrencyCode } from '@/domain/currency/currencies';
import type { SavingsGoal } from '@/domain/models';
import { parsePositiveAmount } from '@/features/transactions/formSchema';
import { currencyFieldSchema, hexColorSchema, nameSchema } from '@/validation/common';
import type { ContributionInput, GoalInput } from '@/validation/planning';

export interface GoalFormValues {
  name: string;
  target: string;
  currency: CurrencyCode;
  hasTargetDate: boolean;
  targetDate: string;
  accountId: string | null;
  icon: string;
  color: string;
}

export function createGoalFormSchema(decimal: string) {
  return z
    .object({
      name: nameSchema,
      target: z.string(),
      currency: currencyFieldSchema,
      hasTargetDate: z.boolean(),
      targetDate: z.string(),
      accountId: z.string().nullable(),
      icon: z.string().max(64),
      color: hexColorSchema,
    })
    .superRefine((v, ctx) => {
      const amount = parsePositiveAmount(v.target, v.currency, decimal);
      if (!amount.ok) ctx.addIssue({ code: 'custom', path: ['target'], message: amount.error });
    });
}

export function toGoalInput(values: GoalFormValues, decimal: string): GoalInput {
  const amount = parsePositiveAmount(values.target, values.currency, decimal);
  /* istanbul ignore next -- the form schema rejects unparsable amounts first */
  if (!amount.ok) throw new Error(amount.error);
  return {
    name: values.name.trim(),
    targetAmountMinor: amount.minor,
    currency: values.currency,
    targetDate: values.hasTargetDate ? values.targetDate : null,
    accountId: values.accountId,
    icon: values.icon,
    color: values.color,
  };
}

export function goalFormValues(
  goal: SavingsGoal,
  targetText: string,
  today: string,
): GoalFormValues {
  return {
    name: goal.name,
    target: targetText,
    currency: goal.currency,
    hasTargetDate: goal.targetDate !== null,
    targetDate: goal.targetDate ?? today,
    accountId: goal.accountId,
    icon: goal.icon ?? 'leaf-outline',
    color: goal.color ?? '#13774F',
  };
}

export interface ContributionFormValues {
  amount: string;
  currency: CurrencyCode;
  contributedOn: string;
  time: string;
  accountId: string | null;
  notes: string;
  /** 'none' | 'new' (record a transfer now) | 'link' (existing transfer). */
  transferMode: 'none' | 'new' | 'link';
  fromAccountId: string;
  toAccountId: string;
  transferId: string | null;
}

export function createContributionFormSchema(decimal: string) {
  return z
    .object({
      amount: z.string(),
      currency: currencyFieldSchema,
      contributedOn: z.string(),
      time: z.string(),
      accountId: z.string().nullable(),
      notes: z.string().max(500, { message: 'validation.tooLong' }),
      transferMode: z.enum(['none', 'new', 'link']),
      fromAccountId: z.string(),
      toAccountId: z.string(),
      transferId: z.string().nullable(),
    })
    .superRefine((v, ctx) => {
      const amount = parsePositiveAmount(v.amount, v.currency, decimal);
      if (!amount.ok) ctx.addIssue({ code: 'custom', path: ['amount'], message: amount.error });
      if (v.transferMode === 'new') {
        if (!v.fromAccountId) {
          ctx.addIssue({ code: 'custom', path: ['fromAccountId'], message: 'validation.required' });
        }
        if (!v.toAccountId) {
          ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'validation.required' });
        } else if (v.toAccountId === v.fromAccountId) {
          ctx.addIssue({
            code: 'custom',
            path: ['toAccountId'],
            message: 'transactions.errors.sameAccount',
          });
        }
      }
      if (v.transferMode === 'link' && !v.transferId) {
        ctx.addIssue({ code: 'custom', path: ['transferId'], message: 'validation.required' });
      }
    });
}

export function toContributionInput(
  values: ContributionFormValues,
  decimal: string,
  timeZone: string,
): ContributionInput {
  const amount = parsePositiveAmount(values.amount, values.currency, decimal);
  /* istanbul ignore next -- the form schema rejects unparsable amounts first */
  if (!amount.ok) throw new Error(amount.error);
  return {
    amountMinor: amount.minor,
    currency: values.currency,
    contributedOn: values.contributedOn,
    accountId: values.transferMode === 'new' ? null : values.accountId,
    notes: values.notes,
    transferId: values.transferMode === 'link' ? values.transferId : null,
    newTransfer:
      values.transferMode === 'new'
        ? {
            fromAccountId: values.fromAccountId,
            toAccountId: values.toAccountId,
            localTime: values.time,
            timeZone,
          }
        : null,
  };
}
