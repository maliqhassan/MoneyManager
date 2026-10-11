import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import ReportsScreen from '@/app/(app)/(tabs)/reports';
import { AppError } from '@/lib/errors';
import { createAccount, createLedger, type Ledger } from '@/test/ledger';
import { queryRootsFor } from '@/providers/queryDependencies';
import { createTestQueryClient, renderWithProviders, TEST_FORMAT_SETTINGS } from '@/test/render';

import { useReportPeriodStore } from '../periodStore';

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
  },
}));
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));

/** "Today" exactly as the app computes it for the test user's time zone. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TEST_FORMAT_SETTINGS.timeZone }).format(new Date());

describe('Reports screen', () => {
  let L: Ledger;

  beforeEach(async () => {
    L = await createLedger();
    mockPush.mockClear();
    mockNavigate.mockClear();
    useReportPeriodStore.getState().reset();
  });
  afterEach(() => L.db.close());

  const add = async (
    type: 'income' | 'expense' | 'refund',
    amountMinor: number,
    accountId: string,
    patch: Record<string, unknown> = {},
  ) =>
    L.repos.transactions.create({
      type,
      accountId,
      amountMinor,
      localDate: today(),
      localTime: '00:01',
      timeZone: TEST_FORMAT_SETTINGS.timeZone,
      categoryId: type === 'income' ? L.cat.salary : L.cat.groceries,
      ...patch,
    });

  it('shows honest empty states (no sample data) when nothing is recorded', async () => {
    await renderWithProviders(<ReportsScreen />, { ledger: L });
    await waitFor(() => expect(screen.getByText('No activity in this period')).toBeOnTheScreen());
    expect(screen.getAllByText('No spending in this period.')).toHaveLength(2);
    expect(screen.getByText('No budgets cover this period.')).toBeOnTheScreen();
    expect(screen.getByText('No active accounts.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Add a transaction' }));
    expect(mockPush).toHaveBeenCalledWith('/transactions/new?type=expense');
  });

  it('reports real totals, savings rate, categories and merchants, with drill-down', async () => {
    const chk = await createAccount(L, { openingBalanceMinor: 10_000 });
    await add('income', 400_000, chk.id);
    await add('expense', 100_000, chk.id, { payee: 'Walmart' });
    await add('refund', 20_000, chk.id, { payee: 'Walmart' });
    await renderWithProviders(<ReportsScreen />, { ledger: L });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Income: $4,000.00' })).toBeOnTheScreen(),
    );
    expect(screen.getByRole('button', { name: 'Spending: $800.00' })).toBeOnTheScreen();
    expect(screen.getByText('Spending is after $200.00 of refunds.')).toBeOnTheScreen();
    expect(screen.getByText('80%')).toBeOnTheScreen(); // (4000 − 800) ÷ 4000
    expect(screen.getByText('+$3,200.00')).toBeOnTheScreen();

    const food = await screen.findByRole('button', { name: 'Food, $800.00, 100% of spending' });
    await fireEvent.press(food);
    expect(mockPush).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /^\/reports\/transactions\?kind=category&title=Food&from=.*&categoryId=.*&sub=1$/,
      ),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Walmart, $800.00, 2 transactions' }));
    expect(mockPush).toHaveBeenLastCalledWith(expect.stringContaining('kind=merchant'));
    await fireEvent.press(screen.getByRole('button', { name: 'Income: $4,000.00' }));
    expect(mockPush).toHaveBeenLastCalledWith(expect.stringContaining('kind=income'));
    // Balance history: opening + postings.
    expect(await screen.findByText('$3,300.00')).toBeOnTheScreen();
  });

  it('changing the period updates every report and keeps the selection visible', async () => {
    const chk = await createAccount(L);
    await add('expense', 5_000, chk.id);
    await renderWithProviders(<ReportsScreen />, { ledger: L });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Spending: $50.00' })).toBeOnTheScreen(),
    );
    await act(async () => useReportPeriodStore.getState().setPreset('last_year'));
    await waitFor(() => expect(screen.getByText('No activity in this period')).toBeOnTheScreen());
    expect(screen.getByText(/^Compared with /)).toBeOnTheScreen();
  });

  it('offers the trend as an accessible table that separates no data from zero', async () => {
    const chk = await createAccount(L);
    await add('expense', 1_000, chk.id);
    await renderWithProviders(<ReportsScreen />, { ledger: L });
    await waitFor(() =>
      expect(screen.getByText('Monthly income and spending, last 12 months')).toBeOnTheScreen(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));
    // Months before the first recorded data say so; they are not shown as zero.
    expect(screen.getAllByText('No data yet').length).toBe(11);
    expect(screen.getAllByText('$10.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Show as chart' })).toBeOnTheScreen();
  });

  it('refreshes after creating, refunding, editing and deleting (same invalidation as the app)', async () => {
    const chk = await createAccount(L);
    const queryClient = createTestQueryClient();
    // Exactly what DataProvider does after every local write.
    const flush = async () => {
      const tables = L.ctx.changes.splice(0);
      await act(async () => {
        for (const table of tables) {
          for (const root of queryRootsFor(table)) {
            await queryClient.invalidateQueries({ queryKey: [root] });
          }
        }
      });
    };
    await renderWithProviders(<ReportsScreen />, { ledger: L, queryClient });
    await waitFor(() => expect(screen.getByText('No activity in this period')).toBeOnTheScreen());

    const id = await add('expense', 6_000, chk.id);
    await flush();
    expect(await screen.findByRole('button', { name: 'Spending: $60.00' })).toBeOnTheScreen();

    await add('refund', 1_000, chk.id);
    await flush();
    expect(await screen.findByRole('button', { name: 'Spending: $50.00' })).toBeOnTheScreen();

    await L.repos.transactions.update(id, {
      type: 'expense',
      accountId: chk.id,
      amountMinor: 9_000,
      localDate: today(),
      localTime: '00:01',
      timeZone: TEST_FORMAT_SETTINGS.timeZone,
      categoryId: L.cat.groceries,
    });
    await flush();
    expect(await screen.findByRole('button', { name: 'Spending: $80.00' })).toBeOnTheScreen();

    await L.repos.budgets.create({
      name: 'Groceries',
      categoryId: L.cat.groceries,
      periodType: 'monthly',
      startDate: today(),
      currency: 'USD',
      amountMinor: 50_000,
    });
    await flush();
    expect(await screen.findByText('$80.00 of $500.00')).toBeOnTheScreen();

    await L.repos.transactions.remove(id);
    await flush();
    expect(await screen.findByRole('button', { name: 'Spending: -$10.00' })).toBeOnTheScreen();
  });

  it('shows a retryable error instead of numbers when a report fails', async () => {
    jest
      .spyOn(L.repos.reports, 'flows')
      .mockRejectedValue(new AppError('storage', 'disk unavailable'));
    await renderWithProviders(<ReportsScreen />, { ledger: L });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0),
    );
  });
});
