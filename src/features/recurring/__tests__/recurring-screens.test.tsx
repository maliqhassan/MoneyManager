import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import RecurringDetailScreen from '@/app/(app)/recurring/[id]/index';
import NewRecurringScreen from '@/app/(app)/recurring/new';
import RemindersScreen from '@/app/(app)/settings/reminders';
import { useReminderSettings } from '@/stores/reminderSettingsStore';
import { createAccount, createLedger, type Ledger, TZ } from '@/test/ledger';
import { renderWithProviders, TEST_FORMAT_SETTINGS } from '@/test/render';

import { RecurringSection, UpcomingSection } from '../components/PlanningSections';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    back: (...a: unknown[]) => mockBack(...a),
    setParams: jest.fn(),
    navigate: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));
// Device settings persist through expo-sqlite's key-value store (native only).
jest.mock('@/stores/persistStorage', () => {
  const mem = new Map<string, string>();
  return {
    devicePersistStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
  };
});
// Device settings are persisted with expo-sqlite's key-value store on the device.
jest.mock('@/stores/persistStorage', () => {
  const mem = new Map<string, string>();
  return {
    devicePersistStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
  };
});
const mockPermission = { status: 'denied', granted: false };
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => mockPermission,
  requestPermissionsAsync: async () => mockPermission,
  setNotificationChannelAsync: async () => null,
  getAllScheduledNotificationsAsync: async () => [],
  scheduleNotificationAsync: async () => 'id',
  cancelScheduledNotificationAsync: async () => undefined,
  PermissionStatus: { UNDETERMINED: 'undetermined', DENIED: 'denied', GRANTED: 'granted' },
  IosAuthorizationStatus: { PROVISIONAL: 3, EPHEMERAL: 4 },
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TEST_FORMAT_SETTINGS.timeZone }).format(new Date());
const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

describe('recurring screens', () => {
  let L: Ledger;
  let chk: Awaited<ReturnType<typeof createAccount>>;
  beforeEach(async () => {
    L = await createLedger();
    chk = await createAccount(L, { openingBalanceMinor: 100_000 });
    mockPush.mockClear();
    mockBack.mockClear();
    mockParams = {};
  });
  afterEach(() => L.db.close());

  const rule = (startDate = today()) =>
    L.repos.recurring.create({
      type: 'expense',
      accountId: chk.id,
      categoryId: L.cat.household,
      amountMinor: 120_000,
      payee: 'Rent',
      frequency: 'monthly',
      interval: 1,
      startDate,
      timeZone: TZ,
    });

  it('shows honest empty states', async () => {
    await renderWithProviders(<UpcomingSection />, { ledger: L });
    await waitFor(() => expect(screen.getByText('Nothing expected')).toBeOnTheScreen());
    await renderWithProviders(<RecurringSection />, { ledger: L });
    await waitFor(() => expect(screen.getByText('No recurring transactions')).toBeOnTheScreen());
    await press(/^Add recurring transaction$/);
    expect(mockPush).toHaveBeenCalledWith('/recurring/new');
  });

  it('lists what is due today and adds it only when the user confirms', async () => {
    const r = await rule();
    await renderWithProviders(<UpcomingSection />, { ledger: L });
    await waitFor(() => expect(screen.getByText('Rent')).toBeOnTheScreen());
    expect(screen.getByText('Expected expenses')).toBeOnTheScreen();
    expect(screen.getByText(/A plan, not a balance/)).toBeOnTheScreen();
    expect(await L.repos.transactions.list()).toHaveLength(0);
    await press('Add');
    await waitFor(async () => expect(await L.repos.transactions.list()).toHaveLength(1));
    expect((await L.repos.recurring.getById(r.id, today()))!.due).toEqual([]);
  });

  it('previews dates before saving and creates the rule', async () => {
    await renderWithProviders(<NewRecurringScreen />, { ledger: L });
    await waitFor(() => expect(screen.getByText('Next dates')).toBeOnTheScreen());
    expect(screen.getAllByText(/\d{4}/).length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText(/Each date waits for you to add or skip it/)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Amount'), '15.99');
    await fireEvent.changeText(screen.getByLabelText('Payee or merchant'), 'Netflix');
    await press('Save');
    // No category yet: validation message, nothing saved.
    await waitFor(() => expect(screen.getByText('Choose a category.')).toBeOnTheScreen());
    expect(await L.repos.recurring.list(today())).toEqual([]);
  });

  it('cancels a rule only after confirmation and keeps its history', async () => {
    const r = await rule();
    await L.repos.recurring.post(r.id, today(), today());
    mockParams = { id: r.id };
    const alert = jest.spyOn(Alert, 'alert');
    await renderWithProviders(<RecurringDetailScreen />, { ledger: L });
    await waitFor(() => expect(screen.getByText('History')).toBeOnTheScreen());
    expect(screen.getByText('Added')).toBeOnTheScreen();
    await press('Cancel rule');
    expect(alert).toHaveBeenCalledWith(
      'Cancel this recurring transaction?',
      expect.stringContaining('Transactions already added stay'),
      expect.any(Array),
    );
    expect((await L.repos.recurring.getById(r.id, today()))!.rule.status).toBe('active');
    const buttons = alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Cancel rule')!.onPress!();
    await waitFor(async () =>
      expect((await L.repos.recurring.getById(r.id, today()))!.rule.status).toBe('ended'),
    );
    expect(await L.repos.transactions.list()).toHaveLength(1);
    alert.mockRestore();
  });

  it('keeps reminders off and explains when permission is denied', async () => {
    useReminderSettings.setState({ enabled: false });
    await renderWithProviders(<RemindersScreen />, { ledger: L });
    await fireEvent(screen.getByRole('switch'), 'valueChange', true);
    await waitFor(() =>
      expect(screen.getByText(/Notifications are turned off for MoneyManager/)).toBeOnTheScreen(),
    );
    expect(useReminderSettings.getState().enabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Open phone settings' })).toBeOnTheScreen();
  });
});
