import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { TransactionListItem } from '@/repositories/types';
import { createLedger, type Ledger } from '@/test/ledger';
import { renderWithProviders } from '@/test/render';

import { SplitEditor } from '../components/SplitEditor';
import { TransactionRow } from '../components/TransactionRow';

const item = (patch: Partial<TransactionListItem> = {}): TransactionListItem => ({
  id: 'tx-1',
  type: 'expense',
  amountMinor: -8_540,
  currency: 'USD',
  payee: 'Grocery Store',
  notes: null,
  localDate: '2026-10-08',
  occurredAt: '2026-10-08T16:00:00.000Z',
  timeZone: 'America/New_York',
  accountId: 'acc',
  accountName: 'Checking',
  categoryId: 'cat',
  categoryName: 'Groceries',
  categorySystemKey: 'groceries',
  categoryIcon: 'cart-outline',
  categoryColor: '#13774F',
  isSplit: false,
  splitCount: 0,
  transferId: null,
  counterpartAccountName: null,
  refundOfTransactionId: null,
  hasReceipt: false,
  ...patch,
});

describe('TransactionRow', () => {
  it('shows merchant, category, account and a signed amount', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<TransactionRow item={item()} onPress={onPress} />);
    const row = screen.getByRole('button', { name: 'Grocery Store, Groceries, Checking, -$85.40' });
    expect(screen.getByText('-$85.40')).toBeOnTheScreen();
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx-1' }));
  });

  it('marks income positive and labels refunds', async () => {
    await renderWithProviders(
      <TransactionRow item={item({ type: 'refund', amountMinor: 3_000 })} onPress={jest.fn()} />,
    );
    expect(screen.getByText('+$30.00')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Refund, / })).toBeOnTheScreen();
  });

  it('presents transfers as movements between accounts, not spending', async () => {
    await renderWithProviders(
      <TransactionRow
        item={item({
          type: 'transfer',
          payee: null,
          categoryId: null,
          categoryName: null,
          amountMinor: -50_000,
          counterpartAccountName: 'Visa',
        })}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('Checking → Visa')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Transfer, Checking to Visa, -$500.00' }),
    ).toBeOnTheScreen();
  });

  it('summarises split transactions', async () => {
    await renderWithProviders(
      <TransactionRow item={item({ isSplit: true, splitCount: 3 })} onPress={jest.fn()} />,
    );
    expect(screen.getByText('Split · 3 categories · Checking')).toBeOnTheScreen();
  });
});

describe('SplitEditor', () => {
  let L: Ledger;
  beforeEach(async () => {
    L = await createLedger();
  });
  afterEach(() => L.db.close());

  const lines = [
    { key: 'a', categoryId: null, amount: '60' },
    { key: 'b', categoryId: null, amount: '15' },
  ];

  it('shows total, allocated and remaining in exact amounts', async () => {
    await renderWithProviders(
      <SplitEditor
        amount="100"
        currency="USD"
        kind="expense"
        lines={lines}
        onChange={jest.fn()}
        newKey={() => 'n'}
        errors={{}}
      />,
      { ledger: L },
    );
    expect(screen.getByText('$100.00')).toBeOnTheScreen();
    expect(screen.getByText('$75.00')).toBeOnTheScreen();
    expect(screen.getByText('Remaining')).toBeOnTheScreen();
    expect(screen.getByText('$25.00')).toBeOnTheScreen();
  });

  it('reports over-allocation and completion', async () => {
    const { rerender } = await renderWithProviders(
      <SplitEditor
        amount="100"
        currency="USD"
        kind="expense"
        lines={[...lines, { key: 'c', categoryId: null, amount: '30' }]}
        onChange={jest.fn()}
        newKey={() => 'n'}
        errors={{}}
      />,
      { ledger: L },
    );
    expect(screen.getByText('Over by')).toBeOnTheScreen();
    await rerender(
      <SplitEditor
        amount="100"
        currency="USD"
        kind="expense"
        lines={[...lines, { key: 'c', categoryId: null, amount: '25' }]}
        onChange={jest.fn()}
        newKey={() => 'n'}
        errors={{}}
      />,
    );
    expect(screen.getByText('Fully allocated')).toBeOnTheScreen();
  });

  it('adds, edits, fills and removes lines', async () => {
    const onChange = jest.fn();
    await renderWithProviders(
      <SplitEditor
        amount="100"
        currency="USD"
        kind="expense"
        lines={lines}
        onChange={onChange}
        newKey={() => 'new'}
        errors={{}}
      />,
      { ledger: L },
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Add split' }));
    expect(onChange).toHaveBeenLastCalledWith([
      ...lines,
      { key: 'new', categoryId: null, amount: '' },
    ]);

    await fireEvent.press(screen.getByRole('button', { name: 'Remove split 2' }));
    expect(onChange).toHaveBeenLastCalledWith([lines[0]]);

    await fireEvent.press(screen.getAllByRole('button', { name: 'Fill remaining' })[0]!);
    expect(onChange).toHaveBeenLastCalledWith([{ ...lines[0], amount: '85.00' }, lines[1]]);

    await fireEvent.changeText(screen.getAllByLabelText('Amount')[1]!, '20');
    expect(onChange).toHaveBeenLastCalledWith([lines[0], { ...lines[1], amount: '20' }]);
  });

  it('lists categories from the repository in the picker', async () => {
    await renderWithProviders(
      <SplitEditor
        amount="100"
        currency="USD"
        kind="expense"
        lines={lines}
        onChange={jest.fn()}
        newKey={() => 'n'}
        errors={{}}
      />,
      { ledger: L },
    );
    await fireEvent.press(screen.getAllByRole('button', { name: /^Category:/ })[0]!);
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Groceries' })).toBeOnTheScreen());
    expect(screen.queryByRole('radio', { name: 'Salary' })).toBeNull(); // income kind excluded
  });
});
