import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import TabsLayout from '@/app/(app)/(tabs)/_layout';
import { renderWithProviders } from '@/test/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

/** Stand-in navigator: renders each screen's name and the shared header button. */
jest.mock('expo-router/js-tabs', () => {
  const { Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  function Tabs({
    children,
    screenOptions,
  }: {
    children: ReactNode;
    screenOptions: { headerRight?: () => ReactElement };
  }) {
    return (
      <View>
        <View testID="header-right">{screenOptions.headerRight?.()}</View>
        {children}
      </View>
    );
  }
  Tabs.Screen = function TabScreen({ name }: { name: string }) {
    return <Text testID="tab-route">{name}</Text>;
  };
  return { Tabs };
});

describe('tabs layout', () => {
  beforeEach(() => mockPush.mockClear());

  it('has no More tab; the routes stay the same otherwise', async () => {
    await renderWithProviders(<TabsLayout />);
    expect(screen.getAllByTestId('tab-route').map((n) => n.props.children)).toEqual([
      'index',
      'transactions',
      'compose',
      'budgets',
      'reports',
    ]);
  });

  it('puts a labelled settings gear at the top right that opens Settings', async () => {
    await renderWithProviders(<TabsLayout />);
    const gear = screen.getByRole('button', { name: 'Settings' });
    expect(gear).toBeOnTheScreen();
    await fireEvent.press(gear);
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });
});
