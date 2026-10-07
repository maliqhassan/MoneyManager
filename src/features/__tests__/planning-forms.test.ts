import type { Bill, Budget, SavingsGoal } from '@/domain/models';
import {
  billFormValues,
  createBillFormSchema,
  parseInterval,
  toBillInput,
} from '@/features/bills/formSchema';
import {
  budgetFormValues,
  createBudgetFormSchema,
  toBudgetInput,
} from '@/features/budgets/formSchema';
import {
  createContributionFormSchema,
  createGoalFormSchema,
  goalFormValues,
  toContributionInput,
  toGoalInput,
} from '@/features/goals/formSchema';
import { QUERY_DEPENDENTS, queryRootsFor } from '@/providers/queryDependencies';

const synced = {
  id: 'x',
  userId: 'u',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  deletedAt: null,
  version: 1,
};

const issues = (r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
  r.success ? {} : Object.fromEntries(r.error!.issues.map((i) => [i.path.join('.'), i.message]));

describe('budget form', () => {
  const base = {
    scope: 'category' as const,
    categoryId: 'c1',
    name: 'Groceries',
    amount: '600',
    currency: 'USD' as const,
    periodType: 'monthly' as const,
    startDate: '2026-10-01',
    endDate: null,
    rolloverEnabled: true,
  };

  it('parses locale amounts exactly into minor units (no floats)', () => {
    expect(createBudgetFormSchema(',').safeParse({ ...base, amount: '1.234,56' }).success).toBe(
      true,
    );
    expect(toBudgetInput({ ...base, amount: '1.234,56' }, ',')).toMatchObject({
      amountMinor: 123_456,
    });
    expect(toBudgetInput({ ...base, amount: '0.1', currency: 'KWD' }, '.').amountMinor).toBe(100);
    expect(toBudgetInput({ ...base, amount: '500', currency: 'JPY' }, '.').amountMinor).toBe(500);
  });

  it('requires a category for category budgets and a valid custom range', () => {
    const schema = createBudgetFormSchema('.');
    expect(issues(schema.safeParse({ ...base, categoryId: null }))).toEqual({
      categoryId: 'budgets.errors.categoryRequired',
    });
    expect(issues(schema.safeParse({ ...base, periodType: 'custom', endDate: null }))).toEqual({
      endDate: 'budgets.errors.endRequired',
    });
    expect(
      issues(schema.safeParse({ ...base, periodType: 'custom', endDate: '2026-09-30' })),
    ).toEqual({ endDate: 'budgets.errors.endBeforeStart' });
    expect(issues(schema.safeParse({ ...base, amount: '0' }))).toEqual({
      amount: 'validation.amountMustBePositive',
    });
  });

  it('drops the category for overall budgets and rollover for custom ones', () => {
    expect(toBudgetInput({ ...base, scope: 'overall' }, '.').categoryId).toBeNull();
    expect(
      toBudgetInput({ ...base, periodType: 'custom', endDate: '2026-12-01' }, '.'),
    ).toMatchObject({ rolloverEnabled: false, endDate: '2026-12-01' });
    expect(toBudgetInput({ ...base, endDate: '2026-12-01' }, '.').endDate).toBeNull();
  });

  it('round-trips an existing budget', () => {
    const budget: Budget = {
      ...synced,
      name: 'Total',
      categoryId: null,
      periodType: 'weekly',
      startDate: '2026-10-05',
      endDate: null,
      currency: 'EUR',
      amountMinor: 15_000,
      rolloverEnabled: false,
      isArchived: false,
    };
    expect(budgetFormValues(budget, '150.00')).toMatchObject({
      scope: 'overall',
      amount: '150.00',
    });
  });
});

describe('bill form', () => {
  const base = {
    name: 'Netflix',
    isSubscription: true,
    amount: '15.99',
    isVariableAmount: false,
    currency: 'USD' as const,
    accountId: null,
    categoryId: null,
    preset: 'monthly' as const,
    frequency: 'monthly' as const,
    interval: '1',
    nextDueDate: '2026-10-31',
    hasEnd: false,
    endDate: null,
    reminder: '3',
    autopay: true,
    notes: '',
  };

  it('maps presets and custom schedules', () => {
    expect(toBillInput(base, '.')).toMatchObject({
      amountMinor: 1_599,
      frequency: 'monthly',
      interval: 1,
      reminderDaysBefore: 3,
      endDate: null,
    });
    expect(toBillInput({ ...base, preset: 'quarterly' }, '.')).toMatchObject({
      frequency: 'monthly',
      interval: 3,
    });
    expect(toBillInput({ ...base, preset: 'biweekly' }, '.')).toMatchObject({
      frequency: 'weekly',
      interval: 2,
    });
    expect(
      toBillInput(
        { ...base, preset: 'custom', frequency: 'weekly', interval: '6', reminder: 'none' },
        '.',
      ),
    ).toMatchObject({ frequency: 'weekly', interval: 6, reminderDaysBefore: null });
  });

  it('validates interval, end date and reminder', () => {
    const schema = createBillFormSchema('.');
    expect(issues(schema.safeParse({ ...base, preset: 'custom', interval: '0' }))).toEqual({
      interval: 'bills.errors.interval',
    });
    expect(issues(schema.safeParse({ ...base, hasEnd: true, endDate: '2026-10-01' }))).toEqual({
      endDate: 'bills.errors.endBeforeDue',
    });
    expect(issues(schema.safeParse({ ...base, reminder: 'soon' }))).toEqual({
      reminder: 'bills.errors.reminder',
    });
    expect(parseInterval(' 12 ')).toBe(12);
    expect(parseInterval('366')).toBeNull();
    expect(parseInterval('1.5')).toBeNull();
  });

  it('keeps an unusual stored reminder when editing', () => {
    const bill: Bill = {
      ...synced,
      name: 'Insurance',
      accountId: null,
      categoryId: null,
      amountMinor: 50_000,
      currency: 'GBP',
      isVariableAmount: false,
      isSubscription: false,
      frequency: 'yearly',
      interval: 1,
      anchorDate: '2026-03-01',
      nextDueDate: '2027-03-01',
      endDate: '2030-03-01',
      autopay: false,
      reminderDaysBefore: 14,
      recurringTransactionId: null,
      notes: null,
      isActive: true,
    };
    const values = billFormValues(bill, '500.00');
    expect(values).toMatchObject({ reminder: '14', preset: 'yearly', hasEnd: true, notes: '' });
    expect(toBillInput(values, '.').reminderDaysBefore).toBe(14);
  });
});

describe('goal & contribution forms', () => {
  it('builds goal input with optional target date', () => {
    const values = {
      name: 'Laptop',
      target: '2,000',
      currency: 'USD' as const,
      hasTargetDate: false,
      targetDate: '2027-01-01',
      accountId: null,
      icon: 'laptop-outline',
      color: '#2F55D4',
    };
    expect(createGoalFormSchema('.').safeParse(values).success).toBe(true);
    expect(toGoalInput(values, '.')).toMatchObject({
      targetAmountMinor: 200_000,
      targetDate: null,
    });
    expect(toGoalInput({ ...values, hasTargetDate: true }, '.').targetDate).toBe('2027-01-01');
    const goal: SavingsGoal = {
      ...synced,
      name: 'Laptop',
      targetAmountMinor: 200_000,
      currency: 'USD',
      targetDate: null,
      accountId: null,
      icon: null,
      color: null,
      status: 'active',
    };
    expect(goalFormValues(goal, '2,000.00', '2026-10-08')).toMatchObject({
      hasTargetDate: false,
      targetDate: '2026-10-08',
      icon: 'leaf-outline',
    });
  });

  it('builds contributions with no, new or linked transfers', () => {
    const base = {
      amount: '500',
      currency: 'USD' as const,
      contributedOn: '2026-10-08',
      time: '09:30',
      accountId: 'sav',
      notes: '',
      transferMode: 'none' as const,
      fromAccountId: '',
      toAccountId: '',
      transferId: null,
    };
    const schema = createContributionFormSchema('.');
    expect(toContributionInput(base, '.', 'Asia/Dubai')).toMatchObject({
      amountMinor: 50_000,
      accountId: 'sav',
      transferId: null,
      newTransfer: null,
    });
    expect(
      toContributionInput(
        { ...base, transferMode: 'new', fromAccountId: 'a', toAccountId: 'b' },
        '.',
        'Asia/Dubai',
      ),
    ).toMatchObject({
      accountId: null,
      newTransfer: {
        fromAccountId: 'a',
        toAccountId: 'b',
        localTime: '09:30',
        timeZone: 'Asia/Dubai',
      },
    });
    expect(
      toContributionInput({ ...base, transferMode: 'link', transferId: 't1' }, '.', 'UTC')
        .transferId,
    ).toBe('t1');
    expect(issues(schema.safeParse({ ...base, transferMode: 'new' }))).toEqual({
      fromAccountId: 'validation.required',
      toAccountId: 'validation.required',
    });
    expect(
      issues(
        schema.safeParse({ ...base, transferMode: 'new', fromAccountId: 'a', toAccountId: 'a' }),
      ),
    ).toEqual({ toAccountId: 'transactions.errors.sameAccount' });
    expect(issues(schema.safeParse({ ...base, transferMode: 'link' }))).toEqual({
      transferId: 'validation.required',
    });
  });
});

describe('query invalidation dependencies', () => {
  it('a transaction change refreshes budgets, bills and goals', () => {
    expect(queryRootsFor('transactions')).toEqual([
      'transactions',
      'budgets',
      'bills',
      'savings_goals',
    ]);
    expect(queryRootsFor('categories')).toContain('budgets');
    expect(queryRootsFor('user_preferences')).toContain('budgets');
    expect(queryRootsFor('goal_contributions')).toEqual(['goal_contributions', 'savings_goals']);
    expect(queryRootsFor('tags')).toEqual(['tags']);
    expect(Object.keys(QUERY_DEPENDENTS)).toContain('bill_payments');
  });
});
