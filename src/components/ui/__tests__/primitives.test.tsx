import { fireEvent, screen } from '@testing-library/react-native';

import { AppError } from '@/lib/errors';
import { renderWithProviders } from '@/test/render';

import { Button } from '../Button';
import { MoneyText } from '../MoneyText';
import { ProgressBar } from '../ProgressBar';
import { EmptyState, ErrorState } from '../StateViews';

jest.mock('@/hooks/useFormatLocale', () => ({ useFormatLocale: () => 'en-US' }));

describe('Button', () => {
  it('is an accessible button that fires onPress', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button label="Save" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire while loading and reports busy state', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button label="Save" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('MoneyText', () => {
  it('renders exact, locale-formatted amounts', async () => {
    await renderWithProviders(<MoneyText value={{ amountMinor: -123456, currency: 'USD' }} />);
    expect(screen.getByText('-$1,234.56')).toBeOnTheScreen();
  });
});

describe('ProgressBar', () => {
  it('exposes progress to screen readers, clamped to 0–100', async () => {
    await renderWithProviders(
      <ProgressBar valueBasisPoints={12_500} accessibilityLabel="Groceries budget" />,
    );
    expect(screen.getByRole('progressbar', { name: 'Groceries budget' })).toHaveAccessibilityValue({
      min: 0,
      max: 100,
      now: 100,
    });
  });
});

describe('state views', () => {
  it('renders an empty state with its action', async () => {
    const onAction = jest.fn();
    await renderWithProviders(
      <EmptyState
        icon="wallet-outline"
        title="Nothing here"
        actionLabel="Add"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('Nothing here')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    expect(onAction).toHaveBeenCalled();
  });

  it('shows a friendly message and never the internal error text', async () => {
    const error = new AppError('network', 'TypeError: fetch failed at internal/stack.js:42');
    await renderWithProviders(<ErrorState error={error} onRetry={() => undefined} />);
    expect(screen.getByText(/couldn't reach the server/i)).toBeOnTheScreen();
    expect(screen.queryByText(/internal\/stack/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });
});
