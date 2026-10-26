import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import TransactionsScreen from '@/app/(app)/(tabs)/transactions';
import TransactionDetailScreen from '@/app/(app)/transactions/[id]/index';
import { createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';
import { renderWithProviders, TEST_FORMAT_SETTINGS } from '@/test/render';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    back: jest.fn(),
    setParams: jest.fn(),
    navigate: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TEST_FORMAT_SETTINGS.timeZone }).format(new Date());

describe('transaction detail: recurring origin', () => {
  let L: Ledger;
  beforeEach(async () => {
    L = await createLedger();
    mockPush.mockClear();
  });
  afterEach(() => L.db.close());

  it('says which recurring rule and occurrence created the entry, and links to the rule', async () => {
    const chk = await createAccount(L, { openingBalanceMinor: 100_000 });
    const date = today();
    const rule = await L.repos.recurring.create({
      type: 'expense',
      accountId: chk.id,
      categoryId: L.cat.household,
      amountMinor: 120_000,
      payee: 'Rent',
      frequency: 'monthly',
      interval: 1,
      startDate: date,
      timeZone: TZ,
    });
    const posted = await L.repos.recurring.post(rule.id, date, date);
    if (posted.status !== 'posted') throw new Error('not posted');
    const tx = await L.repos.transactions.getById(posted.transactionId);
    expect(tx?.transaction).toMatchObject({
      recurringTransactionId: rule.id,
      recurrenceDate: date,
    });

    mockParams = { id: posted.transactionId };
    await renderWithProviders(<TransactionDetailScreen />, { ledger: L });
    const link = await screen.findByRole('link', {
      name: /Created by a recurring transaction for/,
    });
    await fireEvent.press(link);
    expect(mockPush).toHaveBeenCalledWith(`/recurring/${rule.id}`);
  });

  it('an ordinary entry shows no recurring link', async () => {
    const chk = await createAccount(L);
    const id = await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_250,
      localDate: '2026-10-20',
      localTime: '09:00',
      timeZone: TZ,
      categoryId: L.cat.groceries,
    });
    mockParams = { id };
    await renderWithProviders(<TransactionDetailScreen />, { ledger: L });
    await screen.findByText(/12\.50/);
    expect(screen.queryByText(/recurring transaction/)).toBeNull();
  });
});

describe('Activity: recurring entries', () => {
  let L: Ledger;
  beforeEach(async () => {
    L = await createLedger();
    mockPush.mockClear();
  });
  afterEach(() => L.db.close());

  async function seed() {
    const chk = await createAccount(L, { openingBalanceMinor: 500_000 });
    const date = today();
    const rule = await L.repos.recurring.create({
      type: 'expense',
      accountId: chk.id,
      categoryId: L.cat.household,
      amountMinor: 120_000,
      payee: 'Rent',
      frequency: 'monthly',
      interval: 1,
      startDate: date,
      timeZone: TZ,
    });
    await L.repos.recurring.post(rule.id, date, date);
    await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 4_50,
      localDate: date,
      localTime: '08:00',
      timeZone: TZ,
      categoryId: L.cat.food,
      payee: 'Coffee',
    });
  }

  it('the list marks recurring entries and can show only them', async () => {
    await seed();
    const all = await L.repos.transactions.list();
    expect(all.map((i) => [i.payee, i.isRecurring])).toEqual(
      expect.arrayContaining([
        ['Rent', true],
        ['Coffee', false],
      ]),
    );
    const recurring = await L.repos.transactions.list({ recurringOnly: true });
    expect(recurring.map((i) => i.payee)).toEqual(['Rent']);
  });

  it('shows a Repeats badge, day totals, and the Recurring quick filter', async () => {
    await seed();
    await renderWithProviders(<TransactionsScreen />, { ledger: L });
    expect(await screen.findByText('Rent')).toBeOnTheScreen();
    expect(screen.getByText('Repeats')).toBeOnTheScreen();
    // Today's net in one currency: −1,200.00 − 4.50.
    expect(screen.getByText('-$1,204.50')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('radio', { name: 'Recurring' }));
    await waitFor(() => expect(screen.queryByText('Coffee')).toBeNull());
    expect(screen.getByText('Rent')).toBeOnTheScreen();
  });
});
