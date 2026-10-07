import { z } from 'zod';

import { openingBalanceFromEntry, openingBalanceToEntry } from '@/domain/accounts/accounts';
import type { CurrencyCode } from '@/domain/currency/currencies';
import { ACCOUNT_TYPES, type AccountType } from '@/domain/enums';
import type { Account } from '@/domain/models';
import { parseAmountEntry, type ParseMoneyErrorCode } from '@/domain/money/parse';
import type { Formatter } from '@/i18n/formatter';
import { currencyFieldSchema, hexColorSchema, nameSchema } from '@/validation/common';
import type { AccountInput, AccountUpdate } from '@/validation/entities';

import { resolveAccountColor, resolveAccountIcon } from './meta';

/**
 * Form values are what the user types (amounts as text in their number
 * format). Conversion to integer minor units happens once, here, via the
 * domain parser — never with floats.
 */
export interface AccountFormValues {
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  /** Balance for assets, amount OWED for liabilities (see domain/accounts). */
  amount: string;
  creditLimit: string;
  icon: string;
  color: string;
  notes: string;
  includeInTotals: boolean;
}

const PARSE_ERROR_KEYS: Record<ParseMoneyErrorCode, string> = {
  empty: 'validation.required',
  invalid: 'validation.invalidAmount',
  too_many_decimals: 'validation.tooManyDecimals',
  out_of_range: 'validation.amountTooLarge',
};

function parseOptional(text: string, currency: CurrencyCode, decimal: string) {
  if (text.trim() === '') return { ok: true as const, minor: null };
  const result = parseAmountEntry(text, currency, decimal);
  return result.ok
    ? { ok: true as const, minor: result.value.amountMinor }
    : { ok: false as const, error: result.error };
}

export function createAccountFormSchema(preferredDecimal: string) {
  return z
    .object({
      name: nameSchema,
      type: z.enum(ACCOUNT_TYPES),
      currency: currencyFieldSchema,
      amount: z.string(),
      creditLimit: z.string(),
      icon: z.string().max(64),
      color: hexColorSchema,
      notes: z.string().max(1000, { message: 'validation.tooLong' }),
      includeInTotals: z.boolean(),
    })
    .superRefine((values, ctx) => {
      const amount = parseOptional(values.amount, values.currency, preferredDecimal);
      if (!amount.ok) {
        ctx.addIssue({ code: 'custom', path: ['amount'], message: PARSE_ERROR_KEYS[amount.error] });
      }
      if (values.type === 'credit_card') {
        const limit = parseOptional(values.creditLimit, values.currency, preferredDecimal);
        if (!limit.ok) {
          ctx.addIssue({
            code: 'custom',
            path: ['creditLimit'],
            message: PARSE_ERROR_KEYS[limit.error],
          });
        } else if (limit.minor !== null && limit.minor < 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['creditLimit'],
            message: 'validation.amountMustNotBeNegative',
          });
        }
      }
    });
}

/** Stored, signed opening balance in minor units for validated form values. */
export function openingBalanceMinorFrom(values: AccountFormValues, decimal: string): number {
  const parsed = parseOptional(values.amount, values.currency, decimal);
  const entry = parsed.ok ? (parsed.minor ?? 0) : 0;
  return openingBalanceFromEntry(values.type, entry);
}

function creditLimitMinorFrom(values: AccountFormValues, decimal: string): number | null {
  if (values.type !== 'credit_card') return null;
  const parsed = parseOptional(values.creditLimit, values.currency, decimal);
  return parsed.ok ? parsed.minor : null;
}

export function toAccountInput(
  values: AccountFormValues,
  decimal: string,
  today: string,
): AccountInput {
  return {
    name: values.name,
    type: values.type,
    currency: values.currency,
    openingBalanceMinor: openingBalanceMinorFrom(values, decimal),
    openingBalanceDate: today,
    creditLimitMinor: creditLimitMinorFrom(values, decimal),
    icon: values.icon,
    color: values.color,
    notes: values.notes,
    includeInTotals: values.includeInTotals,
  };
}

/** Patch for editing; currency is handled separately (repository.changeCurrency). */
export function toAccountPatch(values: AccountFormValues, decimal: string): AccountUpdate {
  return {
    name: values.name,
    type: values.type,
    openingBalanceMinor: openingBalanceMinorFrom(values, decimal),
    creditLimitMinor: creditLimitMinorFrom(values, decimal),
    icon: values.icon,
    color: values.color,
    notes: values.notes,
    includeInTotals: values.includeInTotals,
  };
}

export function defaultFormValues(type: AccountType, currency: CurrencyCode): AccountFormValues {
  return {
    name: '',
    type,
    currency,
    amount: '',
    creditLimit: '',
    icon: resolveAccountIcon(type, null),
    color: resolveAccountColor(type, null),
    notes: '',
    includeInTotals: true,
  };
}

export function formValuesFromAccount(account: Account, formatter: Formatter): AccountFormValues {
  const entry = openingBalanceToEntry(account.type, account.openingBalanceMinor);
  return {
    name: account.name,
    type: account.type,
    currency: account.currency,
    amount:
      entry === 0
        ? ''
        : formatter.amountForInput({ amountMinor: entry, currency: account.currency }),
    creditLimit:
      account.creditLimitMinor === null
        ? ''
        : formatter.amountForInput({
            amountMinor: account.creditLimitMinor,
            currency: account.currency,
          }),
    icon: resolveAccountIcon(account.type, account.icon),
    color: resolveAccountColor(account.type, account.color),
    notes: account.notes ?? '',
    includeInTotals: account.includeInTotals,
  };
}
