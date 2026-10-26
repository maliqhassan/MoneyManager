import { fireEvent, screen } from '@testing-library/react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { useKeyboardVisible } from '@/hooks/useKeyboard';
import { renderWithProviders } from '@/test/render';

import { AppTabBar, type TabIcons } from '../AppTabBar';

jest.mock('@/hooks/useKeyboard', () => ({ useKeyboardVisible: jest.fn(() => false) }));

const ROUTES = [
  ['index', 'Home'],
  ['transactions', 'Transactions'],
  ['compose', 'Add'],
  ['budgets', 'Plan'],
  ['reports', 'Reports'],
] as const;

const ICONS: Record<string, TabIcons> = {
  index: { icon: 'home-outline', activeIcon: 'home' },
  transactions: { icon: 'receipt-outline', activeIcon: 'receipt' },
  budgets: { icon: 'pie-chart-outline', activeIcon: 'pie-chart' },
  reports: { icon: 'bar-chart-outline', activeIcon: 'bar-chart' },
};

async function setup(index = 0, defaultPrevented = false) {
  const navigation = {
    emit: jest.fn(() => ({ defaultPrevented })),
    navigate: jest.fn(),
  };
  const onAction = jest.fn();
  const props = {
    state: {
      index,
      routes: ROUTES.map(([name]) => ({ key: `${name}-key`, name, params: undefined })),
    },
    descriptors: Object.fromEntries(
      ROUTES.map(([name, title]) => [`${name}-key`, { options: { title } }]),
    ),
    navigation,
    insets: { top: 0, bottom: 24, left: 0, right: 0 },
  } as unknown as BottomTabBarProps;
  const view = await renderWithProviders(
    <AppTabBar
      {...props}
      icons={ICONS}
      action={{
        routeName: 'compose',
        label: 'Add',
        accessibilityLabel: 'Add a transaction, budget or goal',
        onPress: onAction,
      }}
    />,
  );
  return { navigation, onAction, view };
}

describe('AppTabBar', () => {
  beforeEach(() => jest.mocked(useKeyboardVisible).mockReturnValue(false));

  it('keeps every existing tab, labelled, with the active one selected', async () => {
    await setup(1);
    await screen.findByTestId('app-tab-bar');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual([
      'Home',
      'Transactions',
      'Plan',
      'Reports',
    ]);
    expect(screen.getByRole('tab', { name: 'Transactions' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Home' })).not.toBeSelected();
    // Visible labels, not icon-only.
    // Visible labels on tabs; the round + is icon-only with an accessible name.
    for (const [route, title] of ROUTES) {
      if (route !== 'compose') expect(screen.getByText(title)).toBeOnTheScreen();
    }
  });

  it('switches tabs through the navigator (tabPress can be prevented)', async () => {
    const { navigation } = await setup(0);
    await fireEvent.press(await screen.findByRole('tab', { name: 'Reports' }));
    expect(navigation.emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'reports-key',
      canPreventDefault: true,
    });
    expect(navigation.navigate).toHaveBeenCalledWith('reports', undefined);

    navigation.navigate.mockClear();
    await fireEvent.press(screen.getByRole('tab', { name: 'Home' })); // already focused
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when a listener prevents the tab press', async () => {
    const { navigation } = await setup(0, true);
    await fireEvent.press(await screen.findByRole('tab', { name: 'Reports' }));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('the centre Add control opens the add sheet instead of switching tabs', async () => {
    const { navigation, onAction } = await setup(0);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Add a transaction, budget or goal' }),
    );
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('pads for the system navigation bar', async () => {
    await setup(0);
    expect(await screen.findByTestId('app-tab-bar')).toHaveStyle({ paddingBottom: 24 });
  });

  it('is hidden while the keyboard is open so it never covers the focused field', async () => {
    jest.mocked(useKeyboardVisible).mockReturnValue(true);
    await setup(0);
    expect(screen.queryByTestId('app-tab-bar')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});
