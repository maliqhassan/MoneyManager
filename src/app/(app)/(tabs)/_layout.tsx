import { type Href, router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';

import { AppTabBar, type TabIcons } from '@/features/navigation/AppTabBar';
import { SettingsButton } from '@/features/navigation/TabHeader';
import { FirstRunTips } from '@/features/tips/FirstRunTips';
import { useTheme } from '@/theme';

const TAB_ICONS: Record<string, TabIcons> = {
  index: { icon: 'home-outline', activeIcon: 'home' },
  transactions: { icon: 'receipt-outline', activeIcon: 'receipt' },
  budgets: { icon: 'pie-chart-outline', activeIcon: 'pie-chart' },
  reports: { icon: 'bar-chart-outline', activeIcon: 'bar-chart' },
};

const TIP_ORDER = ['add', 'settings', 'reports'] as const;

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <>
      <Tabs
        tabBar={(props) => (
          <AppTabBar
            {...props}
            icons={TAB_ICONS}
            // Centre "+" opens a new expense (Income / Transfer are one tap away).
            action={{
              routeName: 'compose',
              label: t('tabs.add'),
              accessibilityLabel: t('tabs.addA11y'),
              onPress: () => router.push('/transactions/new?type=expense' as Href),
            }}
          />
        )}
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.text,
          headerTitleStyle: theme.typography.title,
          headerRight: () => <SettingsButton />,
          headerRightContainerStyle: { paddingEnd: theme.spacing.lg },
          sceneStyle: { backgroundColor: theme.colors.background },
        }}
      >
        {/* Every tab draws the same large in-page header (TabHeader). */}
        <Tabs.Screen name="index" options={{ title: t('tabs.home'), headerShown: false }} />
        <Tabs.Screen
          name="transactions"
          options={{ title: t('tabs.transactions'), headerShown: false }}
        />
        <Tabs.Screen name="compose" options={{ title: t('tabs.add') }} />
        <Tabs.Screen name="budgets" options={{ title: t('tabs.budgets'), headerShown: false }} />
        <Tabs.Screen name="reports" options={{ title: t('tabs.reports'), headerShown: false }} />
      </Tabs>
      <FirstRunTips order={TIP_ORDER} />
    </>
  );
}
