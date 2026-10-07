import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import { AccountForm } from '../components/AccountForm';
import { defaultFormValues } from '../formSchema';

describe('AccountForm', () => {
  it('shows translated validation errors and does not submit invalid input', async () => {
    const onSubmit = jest.fn();
    await renderWithProviders(
      <AccountForm
        initialValues={defaultFormValues('checking', 'USD')}
        submitLabel="Add account"
        onSubmit={onSubmit}
      />,
    );
    await fireEvent.changeText(screen.getByLabelText('Current balance'), '12.345');
    await fireEvent.press(screen.getByRole('button', { name: 'Add account' }));
    await waitFor(() =>
      expect(screen.getByText('Too many decimal places for this currency.')).toBeOnTheScreen(),
    );
    expect(screen.getByText('This field is required.')).toBeOnTheScreen();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('switches to "amount owed" for credit cards and previews the stored balance', async () => {
    await renderWithProviders(
      <AccountForm
        initialValues={defaultFormValues('checking', 'USD')}
        submitLabel="Add account"
        onSubmit={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Credit card' }));
    await fireEvent.changeText(screen.getByLabelText('Amount owed'), '850.50');
    expect(screen.getByText('Will be saved as -$850.50')).toBeOnTheScreen();
    expect(screen.getByLabelText('Credit limit (Optional)')).toBeOnTheScreen();
  });

  it('submits valid values', async () => {
    const onSubmit = jest.fn(async (_values: unknown) => undefined);
    await renderWithProviders(
      <AccountForm
        initialValues={defaultFormValues('savings', 'USD')}
        submitLabel="Add account"
        onSubmit={onSubmit}
      />,
    );
    await fireEvent.changeText(screen.getByLabelText('Account name'), 'Rainy day');
    await fireEvent.changeText(screen.getByLabelText('Current balance'), '1,500');
    await fireEvent.press(screen.getByRole('button', { name: 'Add account' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: 'Rainy day',
      type: 'savings',
      amount: '1,500',
    });
  });

  it('locks the currency when the account has history', async () => {
    await renderWithProviders(
      <AccountForm
        initialValues={{ ...defaultFormValues('checking', 'EUR'), name: 'Old' }}
        submitLabel="Save"
        onSubmit={jest.fn()}
        currencyLocked
      />,
    );
    expect(screen.getByRole('button', { name: 'Currency: EUR' })).toBeDisabled();
    expect(
      screen.getByText(/can’t be changed because this account already has transactions/),
    ).toBeOnTheScreen();
  });
});
