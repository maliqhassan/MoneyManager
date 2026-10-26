import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { Account } from '@/domain/models';
import { createAccount, createLedger, type Ledger } from '@/test/ledger';
import { renderWithProviders } from '@/test/render';

import { TransactionForm } from '../components/TransactionForm';
import type { TransactionFormValues } from '../formSchema';

jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-document-picker', () => ({}));

const press = (name: string | RegExp) =>
  fireEvent.press(screen.getAllByRole('button', { name })[0]!);
const key = (label: string) => fireEvent.press(screen.getByText(label));

describe('TransactionForm (amount-first entry)', () => {
  let L: Ledger;
  let account: Account;

  beforeEach(async () => {
    L = await createLedger();
    account = await createAccount(L, { name: 'Wallet', type: 'cash' });
  });
  afterEach(() => L.db.close());

  const values = (patch: Partial<TransactionFormValues> = {}): TransactionFormValues => ({
    type: 'expense',
    amount: '',
    accountId: account.id,
    localDate: '2026-10-20',
    localTime: '09:30',
    payee: '',
    notes: '',
    categoryId: null,
    isSplit: false,
    splits: [],
    tagNames: [],
    refundOfTransactionId: null,
    rememberCategory: false,
    ...patch,
  });

  async function renderForm(initial = values()) {
    const onSubmit = jest.fn(async (_v: TransactionFormValues) => undefined);
    await renderWithProviders(
      <TransactionForm
        initialValues={initial}
        accounts={[account]}
        submitLabel="Save"
        onSubmit={onSubmit}
        receipts={[]}
        onAddReceipt={jest.fn()}
        onRemoveReceipt={jest.fn()}
      />,
      { ledger: L },
    );
    return onSubmit;
  }

  it('types an amount on the keypad, picks a category on the dial, and saves exact text', async () => {
    const onSubmit = await renderForm();
    // Nothing to save yet.
    expect(screen.getByRole('button', { name: 'Enter an amount' })).toBeDisabled();
    await key('1');
    await key('5');
    await press('Decimal separator');
    await key('5');
    expect(screen.getByText('$15.50')).toBeOnTheScreen();

    await fireEvent.press(await screen.findByRole('radio', { name: 'Food' }));
    expect(screen.getByText('Expense · Food')).toBeOnTheScreen();
    await press('Save');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      amount: '15.50',
      categoryId: L.cat.food,
      accountId: account.id,
    });
  });

  it('delete removes one digit; a long press clears the amount', async () => {
    await renderForm();
    await key('9');
    await key('9');
    await press('Delete last digit');
    expect(screen.getByText('$9.00')).toBeOnTheScreen();
    await fireEvent(screen.getByRole('button', { name: 'Delete last digit' }), 'longPress');
    expect(screen.getByText('$0.00')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Enter an amount' })).toBeDisabled();
  });

  it('merchant and note are typed in place in the details card', async () => {
    const onSubmit = await renderForm(values({ amount: '3', categoryId: L.cat.food }));
    await fireEvent.changeText(screen.getByLabelText('Merchant'), 'Corner Cafe');
    await fireEvent.changeText(screen.getByLabelText('Note'), 'Team breakfast');
    await press('Save');
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      payee: 'Corner Cafe',
      notes: 'Team breakfast',
    });
  });

  it('editing keeps the stored amount and shows the chosen category selected on the dial', async () => {
    const onSubmit = await renderForm(values({ amount: '42.10', categoryId: L.cat.groceries }));
    expect(screen.getByText('$42.10')).toBeOnTheScreen();
    expect(await screen.findByRole('radio', { name: 'Groceries' })).toBeSelected();
    await press('Save');
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ amount: '42.10' });
  });

  it('adds several tags separated by commas and reuses existing spellings', async () => {
    await L.repos.transactions.create({
      type: 'expense',
      accountId: account.id,
      amountMinor: 1_00,
      localDate: '2026-10-19',
      localTime: '09:00',
      timeZone: 'America/New_York',
      categoryId: L.cat.food,
      tagNames: ['Trip'],
    });
    const onSubmit = await renderForm(values({ amount: '5', categoryId: L.cat.food }));
    // Existing tags are offered as suggestions once loaded.
    expect(await screen.findByRole('button', { name: 'Add tag: Trip' })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Tags'), 'trip, work,');
    expect(await screen.findByRole('button', { name: 'Remove tag Trip' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Remove tag work' })).toBeOnTheScreen();
    await press('Save');
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ tagNames: ['Trip', 'work'] });
  });
});
