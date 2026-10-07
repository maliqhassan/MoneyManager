import type { Account } from '@/domain/models';
import { createFormatter } from '@/i18n/formatter';
import { TEST_FORMAT_SETTINGS } from '@/test/render';

import {
  type AccountFormValues,
  createAccountFormSchema,
  defaultFormValues,
  formValuesFromAccount,
  toAccountInput,
  toAccountPatch,
} from '../formSchema';

const values = (patch: Partial<AccountFormValues> = {}): AccountFormValues => ({
  ...defaultFormValues('checking', 'USD'),
  name: 'Everyday',
  ...patch,
});

const issues = (decimal: string, v: AccountFormValues) => {
  const result = createAccountFormSchema(decimal).safeParse(v);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('account form validation', () => {
  it('accepts a valid form and an empty balance (zero)', () => {
    expect(issues('.', values({ amount: '1,234.56' }))).toEqual({});
    expect(issues('.', values({ amount: '' }))).toEqual({});
  });

  it('requires a name', () => {
    expect(issues('.', values({ name: '   ' }))).toMatchObject({ name: 'validation.required' });
  });

  it('rejects malformed, NaN-like and over-precise amounts', () => {
    expect(issues('.', values({ amount: 'abc' }))).toMatchObject({
      amount: 'validation.invalidAmount',
    });
    expect(issues('.', values({ amount: 'NaN' }))).toMatchObject({
      amount: 'validation.invalidAmount',
    });
    expect(issues('.', values({ amount: '10.505' }))).toMatchObject({
      amount: 'validation.tooManyDecimals',
    });
    expect(issues('.', values({ currency: 'JPY', amount: '10.5' }))).toMatchObject({
      amount: 'validation.tooManyDecimals',
    });
    expect(issues('.', values({ amount: '99999999999999999' }))).toMatchObject({
      amount: 'validation.amountTooLarge',
    });
  });

  it('validates the credit limit only for credit cards', () => {
    expect(issues('.', values({ type: 'credit_card', creditLimit: '-5' }))).toMatchObject({
      creditLimit: 'validation.amountMustNotBeNegative',
    });
    expect(issues('.', values({ type: 'checking', creditLimit: 'junk' }))).toEqual({});
  });

  it('rejects unknown currencies and colors', () => {
    expect(issues('.', values({ currency: 'XYZ' as never, color: 'red' }))).toMatchObject({
      currency: 'validation.invalidCurrency',
      color: 'validation.invalidColor',
    });
  });
});

describe('form → repository input', () => {
  it('stores what is owed on a credit card as a negative balance', () => {
    const input = toAccountInput(
      values({ type: 'credit_card', amount: '850.50', creditLimit: '5000' }),
      '.',
      '2026-10-08',
    );
    expect(input).toMatchObject({
      openingBalanceMinor: -85_050,
      creditLimitMinor: 500_000,
      openingBalanceDate: '2026-10-08',
    });
  });

  it('parses the user number format exactly (no floats)', () => {
    expect(
      toAccountInput(values({ amount: '1.234,56' }), ',', '2026-10-08').openingBalanceMinor,
    ).toBe(123_456);
    expect(toAccountInput(values({ amount: '0.1' }), '.', '2026-10-08').openingBalanceMinor).toBe(
      10,
    );
    expect(toAccountInput(values({ amount: '-25' }), '.', '2026-10-08').openingBalanceMinor).toBe(
      -2_500,
    );
  });

  it('drops the credit limit for non-card accounts and never sends currency in patches', () => {
    const patch = toAccountPatch(values({ creditLimit: '100' }), '.');
    expect(patch.creditLimitMinor).toBeNull();
    expect(patch).not.toHaveProperty('currency');
  });
});

describe('account → form values', () => {
  it('round-trips a credit card in the user number format', () => {
    const formatter = createFormatter({ ...TEST_FORMAT_SETTINGS, numberFormat: 'period_comma' });
    const account = {
      name: 'Visa',
      type: 'credit_card',
      currency: 'EUR',
      openingBalanceMinor: -85_050,
      creditLimitMinor: 500_000,
      icon: null,
      color: null,
      notes: null,
      includeInTotals: true,
    } as unknown as Account;
    const form = formValuesFromAccount(account, formatter);
    expect(form).toMatchObject({ amount: '850,50', creditLimit: '5000,00', icon: 'card-outline' });
    expect(toAccountPatch(form, ',').openingBalanceMinor).toBe(-85_050);
  });
});
