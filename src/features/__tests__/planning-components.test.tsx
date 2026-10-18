import { fireEvent, screen } from '@testing-library/react-native';

import { evaluateBudget } from '@/domain/planning/budgets';
import { evaluateGoal } from '@/domain/planning/goals';
import { BillRow } from '@/features/bills/components/BillRow';
import { SubscriptionSummaryCard } from '@/features/bills/components/SubscriptionSummaryCard';
import { BudgetCard } from '@/features/budgets/components/BudgetCard';
import { emptyNote } from '@/domain/fx/note';
import { GoalCard } from '@/features/goals/components/GoalCard';
import type { BillListItem, BudgetListItem, GoalListItem } from '@/repositories/types';
import { renderWithProviders } from '@/test/render';

// Cards link to other screens (e.g. Exchange rates); navigation is not under test here.
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));

const synced = {
  id: 'id-1',
  userId: 'u',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  deletedAt: null,
  version: 1,
};

/** Rendering uses the real formatter's "today" in America/New_York. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

function budgetItem(spentMinor: number, missingRates: string[] = []): BudgetListItem {
  const evaluation = evaluateBudget({
    periodType: 'monthly',
    startDate: '2026-10-01',
    endDate: null,
    revisions: [
      {
        id: 'r',
        effectiveFrom: '2026-10-01',
        amountMinor: 50_000,
        rolloverEnabled: false,
        createdAt: 'x',
      },
    ],
    spending: [{ localDate: '2026-10-02', spentMinor }],
    today: '2026-10-15',
    settings: { firstDayOfWeek: 1, monthStartDay: 1 },
  });
  return {
    budget: {
      ...synced,
      name: 'Groceries',
      categoryId: null,
      periodType: 'monthly',
      startDate: '2026-10-01',
      endDate: null,
      currency: 'USD',
      amountMinor: 50_000,
      rolloverEnabled: false,
      isArchived: false,
    },
    category: null,
    evaluation,
    missingRates: missingRates as BudgetListItem['missingRates'],
    fx: emptyNote('USD'),
  };
}

describe('BudgetCard', () => {
  it('shows spent of budget, percentage, remaining and a written status', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<BudgetCard item={budgetItem(32_500)} onPress={onPress} />);
    expect(screen.getByText('$325.00 of $500.00')).toBeOnTheScreen();
    expect(screen.getByText('65% used')).toBeOnTheScreen();
    expect(screen.getByText('$175.00 remaining')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('button', {
        name: /^Groceries, .+, \$325\.00 of \$500\.00, \$175\.00 remaining$/,
      }),
    );
    expect(onPress).toHaveBeenCalled();
  });

  it('says when a budget is over and when totals are incomplete', async () => {
    await renderWithProviders(
      <BudgetCard item={budgetItem(52_000, ['EUR'])} onPress={jest.fn()} />,
    );
    expect(screen.getAllByText('Over budget').length).toBeGreaterThan(0);
    expect(screen.getByText('$20.00 over')).toBeOnTheScreen();
    expect(
      screen.getByText('Total incomplete — exchange rate unavailable for EUR.'),
    ).toBeOnTheScreen();
  });
});

describe('BillRow', () => {
  const bill = (patch: Partial<BillListItem['bill']> = {}): BillListItem => ({
    bill: {
      ...synced,
      name: 'Electricity',
      accountId: 'a',
      categoryId: null,
      amountMinor: 8_000,
      currency: 'USD',
      isVariableAmount: false,
      isSubscription: false,
      frequency: 'monthly',
      interval: 1,
      anchorDate: today(),
      nextDueDate: today(),
      endDate: null,
      autopay: false,
      reminderDaysBefore: null,
      recurringTransactionId: null,
      notes: null,
      isActive: true,
      ...patch,
    },
    accountName: 'Checking',
    categoryName: null,
    categorySystemKey: null,
    categoryIcon: null,
    categoryColor: null,
  });

  it('shows due today with amount and account', async () => {
    await renderWithProviders(<BillRow item={bill()} onPress={jest.fn()} />);
    expect(screen.getByText('$80.00')).toBeOnTheScreen();
    expect(screen.getByText(/^Due today · /)).toBeOnTheScreen();
    expect(screen.getByText('Checking')).toBeOnTheScreen();
  });

  it('flags overdue bills in words, and estimates for variable amounts', async () => {
    await renderWithProviders(
      <BillRow
        item={bill({ nextDueDate: '2020-01-01', isVariableAmount: true })}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('Overdue')).toBeOnTheScreen();
    expect(screen.getByText('≈ $80.00')).toBeOnTheScreen();
  });
});

describe('SubscriptionSummaryCard', () => {
  it('marks approximate totals', async () => {
    await renderWithProviders(
      <SubscriptionSummaryCard
        summary={{
          count: 2,
          perCurrency: [],
          base: {
            currency: 'USD',
            monthly: { amountMinor: 2_000, approximate: false },
            yearly: { amountMinor: 26_000, approximate: true },
          },
          missingRates: [],
          fx: emptyNote('USD'),
        }}
      />,
    );
    expect(screen.getByText('$20.00')).toBeOnTheScreen();
    expect(screen.getByText('≈ $260.00')).toBeOnTheScreen();
    expect(screen.getByText('2 active subscriptions')).toBeOnTheScreen();
  });
});

describe('GoalCard', () => {
  const goal = (savedMinor: number): GoalListItem => ({
    goal: {
      ...synced,
      name: 'Vacation',
      targetAmountMinor: 300_000,
      currency: 'USD',
      targetDate: null,
      accountId: null,
      icon: 'airplane-outline',
      color: '#1F9BD1',
      status: 'active',
    },
    progress: evaluateGoal({
      targetMinor: 300_000,
      savedMinor,
      targetDate: null,
      today: '2026-10-08',
    }),
    missingRates: [],
    fx: emptyNote('USD'),
  });

  it('shows progress and remaining', async () => {
    await renderWithProviders(<GoalCard item={goal(150_000)} onPress={jest.fn()} />);
    expect(screen.getByText('$1,500.00 of $3,000.00')).toBeOnTheScreen();
    expect(screen.getByText('50%')).toBeOnTheScreen();
    expect(screen.getByText('$1,500.00 to go')).toBeOnTheScreen();
  });

  it('shows overfunding without capping', async () => {
    await renderWithProviders(<GoalCard item={goal(320_000)} onPress={jest.fn()} />);
    expect(screen.getByText('$3,200.00 of $3,000.00')).toBeOnTheScreen();
    expect(screen.getByText('107%')).toBeOnTheScreen();
    expect(screen.getByText('$200.00 over target')).toBeOnTheScreen();
  });
});
