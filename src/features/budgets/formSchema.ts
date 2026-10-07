import { z } from 'zod';

import type { CurrencyCode } from '@/domain/currency/currencies';
import { compareDates } from '@/domain/dates/calendar';
import { BUDGET_PERIOD_TYPES, type BudgetPeriodType } from '@/domain/enums';
import type { Budget } from '@/domain/models';
import { parsePositiveAmount } from '@/features/transactions/formSchema';
import { currencyFieldSchema, nameSchema } from '@/validation/common';
import type { BudgetInput } from '@/validation/planning';

/** What the budget form edits; the amount is text in the user's number format. */
export interface BudgetFormValues {
  scope: 'overall' | 'category';
  categoryId: string | null;
  name: string;
  amount: string;
  currency: CurrencyCode;
  periodType: BudgetPeriodType;
  startDate: string;
  endDate: string | null;
  rolloverEnabled: boolean;
}

export function createBudgetFormSchema(decimal: string) {
  return z
    .object({
      scope: z.enum(['overall', 'category']),
      categoryId: z.string().nullable(),
      name: nameSchema,
      amount: z.string(),
      currency: currencyFieldSchema,
      periodType: z.enum(BUDGET_PERIOD_TYPES),
      startDate: z.string(),
      endDate: z.string().nullable(),
      rolloverEnabled: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const amount = parsePositiveAmount(v.amount, v.currency, decimal);
      if (!amount.ok) ctx.addIssue({ code: 'custom', path: ['amount'], message: amount.error });
      if (v.scope === 'category' && !v.categoryId) {
        ctx.addIssue({
          code: 'custom',
          path: ['categoryId'],
          message: 'budgets.errors.categoryRequired',
        });
      }
      if (v.periodType === 'custom') {
        if (!v.endDate) {
          ctx.addIssue({
            code: 'custom',
            path: ['endDate'],
            message: 'budgets.errors.endRequired',
          });
        } else if (compareDates(v.endDate, v.startDate) < 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['endDate'],
            message: 'budgets.errors.endBeforeStart',
          });
        }
      }
    });
}

export function toBudgetInput(values: BudgetFormValues, decimal: string): BudgetInput {
  const amount = parsePositiveAmount(values.amount, values.currency, decimal);
  /* istanbul ignore next -- the form schema rejects unparsable amounts first */
  if (!amount.ok) throw new Error(amount.error);
  const custom = values.periodType === 'custom';
  return {
    name: values.name.trim(),
    categoryId: values.scope === 'category' ? values.categoryId : null,
    periodType: values.periodType,
    startDate: values.startDate,
    endDate: custom ? values.endDate : null,
    currency: values.currency,
    amountMinor: amount.minor,
    rolloverEnabled: custom ? false : values.rolloverEnabled,
  };
}

/** Form values for editing; `amountText` is the current amount formatted for input. */
export function budgetFormValues(budget: Budget, amountText: string): BudgetFormValues {
  return {
    scope: budget.categoryId ? 'category' : 'overall',
    categoryId: budget.categoryId,
    name: budget.name,
    amount: amountText,
    currency: budget.currency,
    periodType: budget.periodType,
    startDate: budget.startDate,
    endDate: budget.endDate,
    rolloverEnabled: budget.rolloverEnabled,
  };
}
