import { act, fireEvent, renderHook, screen } from '@testing-library/react-native';

import WelcomeScreen from '@/app/(auth)/welcome';
import { FirstRunTips, tipAnchor } from '@/features/tips/FirstRunTips';
import { BackupPromptCard } from '@/features/sync/components/BackupPromptCard';
import { useAuthStore } from '@/stores/authStore';
import { useActiveProfile, useLocalModeStore } from '@/stores/localModeStore';
import { renderWithProviders } from '@/test/render';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
  },
}));
jest.mock('@/lib/ids', () => ({
  newId: () => 'a1b2c3d4-0000-4000-8000-00000000aaaa',
  nowIso: () => '2026-10-26T09:00:00.000Z',
}));
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

const press = (name: string | RegExp) =>
  fireEvent.press(screen.getAllByRole('button', { name })[0]!);

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  useLocalModeStore.setState({ guestId: null, introSeen: false, tipsSeen: {} });
  useAuthStore.setState({ status: 'signed_out', user: null });
});

describe('welcome (first launch)', () => {
  it('walks through the slides, then starts without an account', async () => {
    await renderWithProviders(<WelcomeScreen />);
    expect(screen.getByText('All your money in one place')).toBeOnTheScreen();
    await press('Next');
    await press('Next');
    await press('Get started');
    const { guestId, introSeen } = useLocalModeStore.getState();
    expect(guestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(introSeen).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('"I already have an account" opens sign-in without creating local data', async () => {
    await renderWithProviders(<WelcomeScreen />);
    await press('I already have an account');
    expect(mockPush).toHaveBeenCalledWith('/sign-in');
    expect(useLocalModeStore.getState()).toMatchObject({ guestId: null, introSeen: true });
  });

  it('Skip jumps to the last slide', async () => {
    await renderWithProviders(<WelcomeScreen />);
    await press('Skip');
    expect(screen.getByRole('button', { name: 'Get started' })).toBeOnTheScreen();
  });
});

describe('active profile', () => {
  it('is the account when signed in, else the local-only profile, else none', async () => {
    const { result, rerender } = await renderHook(() => useActiveProfile());
    expect(result.current).toBeNull();

    await act(async () => {
      useLocalModeStore.getState().startGuest();
    });
    await rerender({});
    const guestId = useLocalModeStore.getState().guestId!;
    expect(result.current).toEqual({ userId: guestId, mode: 'local' });

    // Right after sign-in the account is active (the local data is merged into it).
    await act(async () => {
      useAuthStore.getState().setSignedIn({
        id: '7d4f4f0c-3c7e-4c1e-9a54-2f7b1d1c9a01',
        email: 'a@b.c',
        emailConfirmed: true,
      });
    });
    await rerender({});
    expect(result.current).toEqual({
      userId: '7d4f4f0c-3c7e-4c1e-9a54-2f7b1d1c9a01',
      mode: 'account',
    });
  });

  it('starting local use twice keeps the same profile', () => {
    const first = useLocalModeStore.getState().startGuest();
    expect(useLocalModeStore.getState().startGuest()).toBe(first);
  });
});

describe('BackupPromptCard', () => {
  it('explains local-only storage and offers sign in or a new account', async () => {
    await renderWithProviders(<BackupPromptCard />);
    expect(screen.getByText(/stored only on this device/)).toBeOnTheScreen();
    await press('Sign in');
    expect(mockPush).toHaveBeenCalledWith('/sign-in');
    await press('Create account');
    expect(mockPush).toHaveBeenCalledWith('/sign-up');
  });
});

describe('FirstRunTips', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const anchor = (x: number, y: number) => ({
    measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(x, y, 48, 48),
  });

  it('points at each control once, then remembers they were seen', async () => {
    tipAnchor('add')(anchor(170, 780));
    tipAnchor('settings')(anchor(330, 40));
    await renderWithProviders(<FirstRunTips order={['add', 'settings', 'reports']} />);
    await act(() => jest.advanceTimersByTimeAsync(1_000));

    expect(screen.getByText('Add a transaction')).toBeOnTheScreen();
    expect(screen.getByText('1 of 3')).toBeOnTheScreen();
    await press('Next');
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Settings')).toBeOnTheScreen();
    // "reports" has no control on screen, so this is the last tip.
    await press('Got it');
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(screen.queryByText('Settings')).toBeNull();
    expect(useLocalModeStore.getState().tipsSeen).toEqual({ add: true, settings: true });
    tipAnchor('add')(null);
    tipAnchor('settings')(null);
  });

  it('Skip dismisses every tip for good', async () => {
    tipAnchor('add')(anchor(170, 780));
    tipAnchor('settings')(anchor(330, 40));
    await renderWithProviders(<FirstRunTips order={['add', 'settings']} />);
    await act(() => jest.advanceTimersByTimeAsync(1_000));
    await press('Skip');
    expect(useLocalModeStore.getState().tipsSeen).toEqual({ add: true, settings: true });
    tipAnchor('add')(null);
    tipAnchor('settings')(null);
  });

  it('shows nothing once seen', async () => {
    useLocalModeStore.setState({ tipsSeen: { add: true } });
    tipAnchor('add')(anchor(170, 780));
    await renderWithProviders(<FirstRunTips order={['add']} />);
    await act(() => jest.advanceTimersByTimeAsync(1_000));
    expect(screen.queryByText('Add a transaction')).toBeNull();
    tipAnchor('add')(null);
  });
});
