import type { CurrencyCode } from '@/domain/currency/currencies';

import {
  createTransactionFormSchema,
  createTransferFormSchema,
  splitTotals,
  toTransactionInput,
  toTransferInput,
  type TransactionFormValues,
} from '../formSchema';

const currencies: Record<string, CurrencyCode> = { usd: 'USD', eur: 'EUR', jpy: 'JPY' };
const ctx = (decimal = '.') => ({ decimal, currencyOf: (id: string) => currencies[id] ?? null });

const values = (patch: Partial<TransactionFormValues> = {}): TransactionFormValues => ({
  type: 'expense',
  amount: '100.00',
  accountId: 'usd',
  localDate: '2026-10-08',
  localTime: '12:00',
  payee: 'Grocery Store',
  notes: '',
  categoryId: 'groceries',
  isSplit: false,
  splits: [],
  tagNames: [],
  refundOfTransactionId: null,
  rememberCategory: false,
  ...patch,
});

const errors = (schema: ReturnType<typeof createTransactionFormSchema>, v: unknown) => {
  const r = schema.safeParse(v);
  return r.success
    ? {}
    : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('transaction form validation', () => {
  const schema = createTransactionFormSchema(ctx());

  it('accepts a valid expense', () => {
    expect(errors(schema, values())).toEqual({});
  });

  it('rejects zero, negative, empty and malformed amounts', () => {
    expect(errors(schema, values({ amount: '0' }))).toMatchObject({
      amount: 'validation.amountMustBePositive',
    });
    expect(errors(schema, values({ amount: '-5' }))).toMatchObject({
      amount: 'validation.amountMustBePositive',
    });
    expect(errors(schema, values({ amount: '' }))).toMatchObject({ amount: 'validation.required' });
    expect(errors(schema, values({ amount: 'abc' }))).toMatchObject({
      amount: 'validation.invalidAmount',
    });
    expect(errors(schema, values({ accountId: 'jpy', amount: '10.5' }))).toMatchObject({
      amount: 'validation.tooManyDecimals',
    });
  });

  it('requires an account and a category (unless split)', () => {
    expect(errors(schema, values({ accountId: '' }))).toMatchObject({
      accountId: 'transactions.errors.accountNotFound',
    });
    expect(errors(schema, values({ categoryId: null }))).toMatchObject({
      categoryId: 'transactions.errors.categoryRequired',
    });
  });

  it('requires splits to add up exactly — no tolerance', () => {
    const split = (a: string, b: string) =>
      values({
        isSplit: true,
        categoryId: null,
        splits: [
          { key: '1', categoryId: 'groceries', amount: a },
          { key: '2', categoryId: 'household', amount: b },
        ],
      });
    expect(errors(schema, split('60', '40'))).toEqual({});
    expect(errors(schema, split('60', '39.99'))).toMatchObject({
      splits: 'transactions.errors.splitMismatch',
    });
    expect(errors(schema, split('60', '40.01'))).toMatchObject({
      splits: 'transactions.errors.splitMismatch',
    });
    expect(
      errors(
        schema,
        values({
          isSplit: true,
          categoryId: null,
          splits: [{ key: '1', categoryId: null, amount: '100' }],
        }),
      ),
    ).toMatchObject({
      splits: 'transactions.errors.splitTooFew',
      'splits.0.categoryId': 'transactions.errors.categoryRequired',
    });
  });

  it('converts to repository input exactly in the user number format', () => {
    const v = values({
      amount: '1.234,56',
      isSplit: true,
      categoryId: 'ignored',
      splits: [
        { key: '1', categoryId: 'groceries', amount: '1.000,00' },
        { key: '2', categoryId: 'household', amount: '234,56' },
      ],
    });
    expect(errors(createTransactionFormSchema(ctx(',')), v)).toEqual({});
    expect(toTransactionInput(v, 'USD', ',', 'Europe/Berlin')).toMatchObject({
      amountMinor: 123_456,
      categoryId: null,
      splits: [
        { categoryId: 'groceries', amountMinor: 100_000 },
        { categoryId: 'household', amountMinor: 23_456 },
      ],
      timeZone: 'Europe/Berlin',
    });
    expect(splitTotals('1.234,56', v.splits, 'USD', ',')).toEqual({
      totalMinor: 123_456,
      allocatedMinor: 123_456,
      remainingMinor: 0,
    });
  });

  it('only links refunds on refund transactions', () => {
    expect(
      toTransactionInput(values({ refundOfTransactionId: 'x' }), 'USD', '.', 'UTC')
        .refundOfTransactionId,
    ).toBeNull();
    expect(
      toTransactionInput(values({ type: 'refund', refundOfTransactionId: 'x' }), 'USD', '.', 'UTC')
        .refundOfTransactionId,
    ).toBe('x');
  });
});

describe('transfer form validation', () => {
  const schema = createTransferFormSchema(ctx());
  const base = {
    amount: '500',
    received: '',
    fromAccountId: 'usd',
    toAccountId: 'usd2',
    localDate: '2026-10-08',
    localTime: '09:00',
    notes: '',
  };
  currencies.usd2 = 'USD';

  it('rejects the same source and destination', () => {
    const r = schema.safeParse({ ...base, toAccountId: 'usd' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain('transactions.errors.sameAccount');
  });

  it('requires a received amount across currencies', () => {
    const r = schema.safeParse({ ...base, toAccountId: 'eur' });
    expect(r.error?.issues.map((i) => i.message)).toEqual([
      'transactions.errors.receivedAmountRequired',
    ]);
    expect(schema.safeParse({ ...base, toAccountId: 'eur', received: '460' }).success).toBe(true);
    expect(
      toTransferInput({ ...base, toAccountId: 'eur', received: '460' }, 'USD', 'EUR', '.', 'UTC'),
    ).toMatchObject({
      amountMinor: 50_000,
      receivedAmountMinor: 46_000,
    });
    expect(toTransferInput(base, 'USD', 'USD', '.', 'UTC').receivedAmountMinor).toBeNull();
  });
});
