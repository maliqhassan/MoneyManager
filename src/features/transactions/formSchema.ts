import { z } from 'zod';

import type { CurrencyCode } from '@/domain/currency/currencies';
import { parseAmountEntry, type ParseMoneyErrorCode } from '@/domain/money/parse';
import { canSplit, type EntryType } from '@/domain/transactions/transactions';
import type { TransactionDetail } from '@/repositories/types';
import type { TransactionInput, TransferInput } from '@/validation/transactions';

/**
 * Form state ↔ repository inputs. Amounts are typed text in the user's number
 * format; they become exact positive minor units here, once, through the
 * domain parser. Split totals are compared as integers — no tolerance.
 */

export interface SplitLineValues {
  key: string;
  categoryId: string | null;
  amount: string;
}

export interface TransactionFormValues {
  type: EntryType;
  amount: string;
  accountId: string;
  localDate: string;
  localTime: string;
  payee: string;
  notes: string;
  categoryId: string | null;
  isSplit: boolean;
  splits: SplitLineValues[];
  tagNames: string[];
  refundOfTransactionId: string | null;
  rememberCategory: boolean;
}

export interface TransferFormValues {
  amount: string;
  received: string;
  fromAccountId: string;
  toAccountId: string;
  localDate: string;
  localTime: string;
  notes: string;
}

const PARSE_ERRORS: Record<ParseMoneyErrorCode, string> = {
  empty: 'validation.required',
  invalid: 'validation.invalidAmount',
  too_many_decimals: 'validation.tooManyDecimals',
  out_of_range: 'validation.amountTooLarge',
};

/** Positive minor units from typed text, or an i18n error key. */
export function parsePositiveAmount(
  text: string,
  currency: CurrencyCode,
  decimal: string,
): { ok: true; minor: number } | { ok: false; error: string } {
  const result = parseAmountEntry(text, currency, decimal);
  if (!result.ok) return { ok: false, error: PARSE_ERRORS[result.error] };
  if (result.value.amountMinor <= 0) return { ok: false, error: 'validation.amountMustBePositive' };
  return { ok: true, minor: result.value.amountMinor };
}

export interface AmountContext {
  decimal: string;
  /** Currency of an account id (null when the account is unknown). */
  currencyOf: (accountId: string) => CurrencyCode | null;
}

export function createTransactionFormSchema(ctx: AmountContext) {
  return z
    .object({
      type: z.enum(['expense', 'income', 'refund']),
      amount: z.string(),
      accountId: z.string(),
      localDate: z.string(),
      localTime: z.string(),
      payee: z.string().max(200, { message: 'validation.tooLong' }),
      notes: z.string().max(1000, { message: 'validation.tooLong' }),
      categoryId: z.string().nullable(),
      isSplit: z.boolean(),
      splits: z.array(
        z.object({ key: z.string(), categoryId: z.string().nullable(), amount: z.string() }),
      ),
      tagNames: z.array(z.string()),
      refundOfTransactionId: z.string().nullable(),
      rememberCategory: z.boolean(),
    })
    .superRefine((v, issue) => {
      const add = (path: (string | number)[], message: string) =>
        issue.addIssue({ code: 'custom', path, message });
      const currency = ctx.currencyOf(v.accountId);
      if (!currency) add(['accountId'], 'transactions.errors.accountNotFound');
      const total = currency ? parsePositiveAmount(v.amount, currency, ctx.decimal) : null;
      if (total && !total.ok) add(['amount'], total.error);

      if (v.isSplit && canSplit(v.type)) {
        if (v.splits.length < 2) add(['splits'], 'transactions.errors.splitTooFew');
        let sum = 0;
        v.splits.forEach((line, index) => {
          if (!line.categoryId)
            add(['splits', index, 'categoryId'], 'transactions.errors.categoryRequired');
          const parsed = currency ? parsePositiveAmount(line.amount, currency, ctx.decimal) : null;
          if (parsed && !parsed.ok) add(['splits', index, 'amount'], parsed.error);
          if (parsed?.ok) sum += parsed.minor;
        });
        if (total?.ok && sum !== total.minor) add(['splits'], 'transactions.errors.splitMismatch');
      } else if (!v.categoryId) {
        add(['categoryId'], 'transactions.errors.categoryRequired');
      }
    });
}

export function createTransferFormSchema(ctx: AmountContext) {
  return z
    .object({
      amount: z.string(),
      received: z.string(),
      fromAccountId: z.string(),
      toAccountId: z.string(),
      localDate: z.string(),
      localTime: z.string(),
      notes: z.string().max(1000, { message: 'validation.tooLong' }),
    })
    .superRefine((v, issue) => {
      const add = (path: string[], message: string) =>
        issue.addIssue({ code: 'custom', path, message });
      const from = ctx.currencyOf(v.fromAccountId);
      const to = ctx.currencyOf(v.toAccountId);
      if (!from) add(['fromAccountId'], 'transactions.errors.accountNotFound');
      if (!to) add(['toAccountId'], 'transactions.errors.accountNotFound');
      if (v.fromAccountId && v.fromAccountId === v.toAccountId) {
        add(['toAccountId'], 'transactions.errors.sameAccount');
      }
      if (from) {
        const amount = parsePositiveAmount(v.amount, from, ctx.decimal);
        if (!amount.ok) add(['amount'], amount.error);
      }
      if (from && to && from !== to) {
        const received = parsePositiveAmount(v.received, to, ctx.decimal);
        if (!received.ok) {
          add(
            ['received'],
            received.error === 'validation.required'
              ? 'transactions.errors.receivedAmountRequired'
              : received.error,
          );
        }
      }
    });
}

const amountOf = (text: string, currency: CurrencyCode, decimal: string): number => {
  const parsed = parsePositiveAmount(text, currency, decimal);
  return parsed.ok ? parsed.minor : 0;
};

export function toTransactionInput(
  v: TransactionFormValues,
  currency: CurrencyCode,
  decimal: string,
  timeZone: string,
): TransactionInput {
  const split = v.isSplit && canSplit(v.type);
  return {
    type: v.type,
    accountId: v.accountId,
    amountMinor: amountOf(v.amount, currency, decimal),
    localDate: v.localDate,
    localTime: v.localTime,
    timeZone,
    payee: v.payee,
    notes: v.notes,
    categoryId: split ? null : v.categoryId,
    splits: split
      ? v.splits.map((s) => ({
          categoryId: s.categoryId ?? '',
          amountMinor: amountOf(s.amount, currency, decimal),
        }))
      : [],
    tagNames: v.tagNames,
    refundOfTransactionId: v.type === 'refund' ? v.refundOfTransactionId : null,
  };
}

export function toTransferInput(
  v: TransferFormValues,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  decimal: string,
  timeZone: string,
): TransferInput {
  return {
    fromAccountId: v.fromAccountId,
    toAccountId: v.toAccountId,
    amountMinor: amountOf(v.amount, fromCurrency, decimal),
    receivedAmountMinor:
      fromCurrency === toCurrency ? null : amountOf(v.received, toCurrency, decimal),
    localDate: v.localDate,
    localTime: v.localTime,
    timeZone,
    notes: v.notes,
  };
}

/** Split editor totals in minor units (unparseable lines count as 0). */
export function splitTotals(
  amount: string,
  lines: readonly SplitLineValues[],
  currency: CurrencyCode,
  decimal: string,
): { totalMinor: number; allocatedMinor: number; remainingMinor: number } {
  const totalMinor = amountOf(amount, currency, decimal);
  const allocatedMinor = lines.reduce((acc, l) => acc + amountOf(l.amount, currency, decimal), 0);
  return { totalMinor, allocatedMinor, remainingMinor: totalMinor - allocatedMinor };
}

/** Pre-fills the edit form from a stored transaction. */
export function formValuesFromDetail(
  detail: TransactionDetail,
  amountForInput: (minor: number, currency: CurrencyCode) => string,
  localTime: string,
): TransactionFormValues {
  const t = detail.transaction;
  return {
    type: t.type as EntryType,
    amount: amountForInput(Math.abs(t.amountMinor), t.currency),
    accountId: t.accountId,
    localDate: t.localDate,
    localTime,
    payee: t.payee ?? '',
    notes: t.notes ?? '',
    categoryId: t.categoryId,
    isSplit: t.isSplit,
    splits: detail.splits.map((s) => ({
      key: s.id,
      categoryId: s.categoryId,
      amount: amountForInput(Math.abs(s.amountMinor), t.currency),
    })),
    tagNames: detail.tags.map((tag) => tag.name),
    refundOfTransactionId: t.refundOfTransactionId,
    rememberCategory: false,
  };
}
