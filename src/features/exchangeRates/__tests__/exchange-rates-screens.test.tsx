import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ExchangeRatesScreen from '@/app/(app)/settings/exchange-rates';
import ManualRateScreen from '@/app/(app)/settings/manual-rate';
import { addDays } from '@/domain/dates/calendar';
import { ConversionNoteBuilder, emptyNote } from '@/domain/fx/note';
import type { ProviderRate } from '@/domain/fx/frankfurter';
import { ProviderError } from '@/services/fx/provider';
import { useSyncStore } from '@/stores/syncStore';
import { createAccount, createLedger, type Ledger } from '@/test/ledger';
import { renderWithProviders, TEST_FORMAT_SETTINGS } from '@/test/render';

import { RateNote } from '../components/RateNote';
import { setRateProviderForTests, useFxRefreshStore } from '../refreshStore';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
  },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TEST_FORMAT_SETTINGS.timeZone }).format(new Date());
const META = {
  source: 'frankfurter',
  attribution: 'Frankfurter',
  fetchedAt: '2026-10-01T00:00:00Z',
};
const usd = (quote: ProviderRate['quote'], rate: string, rateDate = today()): ProviderRate => ({
  base: 'USD',
  quote,
  rate,
  rateDate,
});
const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

describe('RateNote', () => {
  it('renders nothing for single-currency totals', async () => {
    await renderWithProviders(<RateNote note={emptyNote('USD')} />);
    expect(screen.queryByText(/Converted to/)).toBeNull();
  });

  it('labels converted, stale, user-entered and missing amounts', async () => {
    const b = new ConversionNoteBuilder('USD');
    b.addSnapshot();
    b.addRate('EUR', {
      from: 'EUR',
      to: 'USD',
      rate: '1.1',
      rateDate: '2026-10-05',
      source: 'frankfurter',
      kind: 'provider',
      derivation: 'direct',
      stale: true,
    });
    b.addRate('PKR', {
      from: 'PKR',
      to: 'USD',
      rate: '0.0036',
      rateDate: '2026-10-07',
      source: 'manual',
      kind: 'manual',
      derivation: 'direct',
      stale: false,
    });
    b.addMissing('GBP');
    await renderWithProviders(
      <RateNote note={b.build()} policy="Estimated at the latest rates." />,
    );
    expect(screen.getByText('Converted to USD · Estimated at the latest rates.')).toBeOnTheScreen();
    expect(screen.getByText('EUR: rate of Oct 5, 2026 (Frankfurter)')).toBeOnTheScreen();
    expect(screen.getByText('PKR: rate of Oct 7, 2026 (Your rate)')).toBeOnTheScreen();
    expect(screen.getByText('Includes rates you entered.')).toBeOnTheScreen();
    expect(screen.getByText('Some rates are more than 3 days old.')).toBeOnTheScreen();
    expect(screen.getByText('No rate for GBP — those amounts are not included.')).toBeOnTheScreen();
    expect(
      screen.getByText('Includes entries converted with the rate saved when they were recorded.'),
    ).toBeOnTheScreen();
    await press('Exchange rates');
    expect(mockPush).toHaveBeenCalledWith('/settings/exchange-rates');
  });
});

describe('Exchange rates screen', () => {
  let L: Ledger;
  beforeEach(async () => {
    L = await createLedger();
    mockPush.mockClear();
    mockBack.mockClear();
    mockParams = {};
    useSyncStore.getState().setOnline(true);
    useFxRefreshStore.setState({ refreshing: false, last: null });
  });
  afterEach(() => L.db.close());

  it('shows each currency in the base currency, with source and date, or that a rate is missing', async () => {
    await createAccount(L, { name: 'Euro', currency: 'EUR' });
    await createAccount(L, { name: 'Pound', currency: 'GBP' });
    await L.repos.exchangeRates.storeProviderRates([usd('EUR', '0.8')], META);
    await renderWithProviders(<ExchangeRatesScreen />, { ledger: L });
    await waitFor(() => expect(screen.getByText('1 EUR = 1.25 USD')).toBeOnTheScreen());
    expect(screen.getByText(/^Frankfurter · /)).toBeOnTheScreen();
    expect(screen.getByText('No rate yet')).toBeOnTheScreen();
    expect(
      screen.getByText('Totals that need GBP are marked incomplete until a rate is available.'),
    ).toBeOnTheScreen();
    expect(screen.getByText(/Reference rates from Frankfurter/)).toBeOnTheScreen();
    expect(screen.getByText(/Only currency codes are sent/)).toBeOnTheScreen();
    expect(screen.getByText('Rates have not been downloaded yet.')).toBeOnTheScreen();
    await press('Add a GBP rate');
    expect(mockPush).toHaveBeenCalledWith('/settings/manual-rate?from=GBP&to=USD');
    await press('Add a rate');
    expect(mockPush).toHaveBeenLastCalledWith('/settings/manual-rate?to=USD');
  });

  it('marks old cached rates as stale instead of current', async () => {
    await createAccount(L, { name: 'Euro', currency: 'EUR' });
    await L.repos.exchangeRates.storeProviderRates(
      [usd('EUR', '0.8', addDays(today(), -10))],
      META,
    );
    await renderWithProviders(<ExchangeRatesScreen />, { ledger: L });
    await waitFor(() => expect(screen.getByText('Older rate')).toBeOnTheScreen());
    expect(
      screen.getByText('This is the newest saved rate. Refresh when you’re online.'),
    ).toBeOnTheScreen();
  });

  it('refreshes on request and reports failures without losing saved rates', async () => {
    await createAccount(L, { name: 'Euro', currency: 'EUR' });
    const calls: string[] = [];
    setRateProviderForTests({
      id: 'frankfurter',
      attribution: 'Frankfurter',
      fetchRates: async (_base, quotes) => {
        calls.push(quotes.join(','));
        return [usd('EUR', '0.8')];
      },
    });
    await renderWithProviders(<ExchangeRatesScreen />, { ledger: L });
    await waitFor(() => expect(screen.getByText('No rate yet')).toBeOnTheScreen());
    await press('Refresh now');
    await waitFor(() => expect(screen.getByText('Rates updated.')).toBeOnTheScreen());
    expect(calls[0]).toBe('EUR');
    expect(await L.repos.exchangeRates.findRate('EUR', 'USD', today())).toBe('1.25');

    setRateProviderForTests({
      id: 'frankfurter',
      attribution: 'Frankfurter',
      fetchRates: async () => {
        throw new ProviderError('offline', 'down');
      },
    });
    await press('Refresh now');
    await waitFor(() =>
      expect(screen.getByText('You’re offline. Saved rates are still used.')).toBeOnTheScreen(),
    );
    expect(await L.repos.exchangeRates.findRate('EUR', 'USD', today())).toBe('1.25');
  });

  it('disables refresh while offline', async () => {
    useSyncStore.getState().setOnline(false);
    await createAccount(L, { name: 'Euro', currency: 'EUR' });
    await renderWithProviders(<ExchangeRatesScreen />, { ledger: L });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh now' })).toBeDisabled());
    expect(screen.getByText('You’re offline. Saved rates are still used.')).toBeOnTheScreen();
  });

  it('lists the user’s own rates and deletes one only after confirmation', async () => {
    await L.repos.exchangeRates.saveManualRate(
      { base: 'EUR', quote: 'PKR', rate: '310.5', rateDate: today() },
      { today: today(), replace: false },
    );
    const alert = jest.spyOn(Alert, 'alert');
    await renderWithProviders(<ExchangeRatesScreen />, { ledger: L });
    await waitFor(() => expect(screen.getByText('1 EUR = 310.5 PKR')).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole('button', { name: /^Delete rate: 1 EUR = 310.5 PKR/ }));
    expect(alert).toHaveBeenCalledWith(
      'Delete this rate?',
      expect.stringContaining('Entries already recorded keep the conversion'),
      expect.any(Array),
    );
    expect(await L.repos.exchangeRates.listManualRates()).toHaveLength(1);
    const buttons = alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Delete rate')!.onPress!();
    await waitFor(async () => expect(await L.repos.exchangeRates.listManualRates()).toEqual([]));
    alert.mockRestore();
  });
});

describe('Manual rate screen', () => {
  let L: Ledger;
  beforeEach(async () => {
    L = await createLedger();
    mockBack.mockClear();
    mockParams = { from: 'EUR', to: 'PKR' };
  });
  afterEach(() => L.db.close());

  it('previews the direction, requires a review step and saves exactly', async () => {
    await renderWithProviders(<ManualRateScreen />, { ledger: L });
    const field = screen.getByLabelText('Rate');
    expect(screen.getByRole('button', { name: 'Review rate' })).toBeDisabled();
    await fireEvent.changeText(field, 'abc');
    expect(screen.getByText('Enter a valid exchange rate.')).toBeOnTheScreen();
    await fireEvent.changeText(field, '310.5');
    expect(screen.getByText('1 EUR = 310.5 PKR')).toBeOnTheScreen();
    expect(screen.getByText('So 1 PKR = 0.00322061191626 EUR')).toBeOnTheScreen();
    expect(screen.getByText(/^Example: €100\.00 → PKR\s?31,050\.00$/)).toBeOnTheScreen();
    // Nothing is saved before the review step is confirmed.
    await press('Review rate');
    expect(screen.getByText('Save this rate?')).toBeOnTheScreen();
    expect(await L.repos.exchangeRates.listManualRates()).toEqual([]);
    // The check for an existing rate runs first; then saving is possible.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save rate' })).toBeEnabled());
    await press('Save rate');
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(await L.repos.exchangeRates.listManualRates()).toEqual([
      expect.objectContaining({ base: 'EUR', quote: 'PKR', rate: '310.5', rateDate: today() }),
    ]);
  });

  it('asks before replacing a rate already entered for that date', async () => {
    await L.repos.exchangeRates.saveManualRate(
      { base: 'EUR', quote: 'PKR', rate: '300', rateDate: today() },
      { today: today(), replace: false },
    );
    await renderWithProviders(<ManualRateScreen />, { ledger: L });
    await fireEvent.changeText(screen.getByLabelText('Rate'), '310.5');
    await press('Review rate');
    await waitFor(() =>
      expect(
        screen.getByText('You already entered a rate for this date (300). It will be replaced.'),
      ).toBeOnTheScreen(),
    );
    await press('Replace rate');
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(await L.repos.exchangeRates.listManualRates()).toEqual([
      expect.objectContaining({ rate: '310.5' }),
    ]);
  });

  it('rejects the same currency on both sides', async () => {
    mockParams = { from: 'USD', to: 'USD' };
    await renderWithProviders(<ManualRateScreen />, { ledger: L });
    await fireEvent.changeText(screen.getByLabelText('Rate'), '1');
    expect(screen.getByText('Choose two different currencies.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Review rate' })).toBeDisabled();
  });
});
