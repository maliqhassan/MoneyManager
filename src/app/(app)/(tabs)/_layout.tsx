import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';
import { type ColorValue, Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui';
import { makeStyles, useTheme } from '@/theme';

interface TabBarIconProps {
  focused: boolean;
  color: ColorValue;
  size: number;
}

/** The tab bar passes the resolved tint color for the active/inactive state. */
function tabIcon(name: IconName, focusedName: IconName) {
  return function TabBarIcon({ focused, color, size }: TabBarIconProps) {
    return <Ionicons name={focused ? focusedName : name} color={color} size={size} />;
  };
}

/** Centre "+" control. Opens the Add sheet instead of switching tabs. */
function AddTabButton({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.addSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => router.push('/add')}
        style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
      >
        <Icon name="add" size={30} tone="onPrimary" />
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
        headerTitleStyle: theme.typography.heading,
        sceneStyle: { backgroundColor: theme.colors.background },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: { backgroundColor: theme.colors.tabBar, borderTopColor: theme.colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarAllowFontScaling: true,
        tabBarLabelPosition: 'below-icon',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('tabs.home'), tabBarIcon: tabIcon('home-outline', 'home') }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: t('tabs.transactions'),
          tabBarIcon: tabIcon('list-outline', 'list'),
        }}
      />
      <Tabs.Screen
        name="compose"
        options={{
          title: t('tabs.add'),
          tabBarButton: () => <AddTabButton label={t('tabs.addA11y')} />,
        }}
      />
      <Tabs.Screen
        name="budgets"
        options={{
          title: t('tabs.budgets'),
          tabBarIcon: tabIcon('pie-chart-outline', 'pie-chart'),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t('tabs.reports'),
          tabBarIcon: tabIcon('bar-chart-outline', 'bar-chart'),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('tabs.more'),
          tabBarIcon: tabIcon('ellipsis-horizontal-circle-outline', 'ellipsis-horizontal-circle'),
        }}
      />
    </Tabs>
  );
}

const useStyles = makeStyles((t) => ({
  addSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  addButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: t.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -t.spacing.md,
    ...t.elevation.medium,
  },
  addButtonPressed: { backgroundColor: t.colors.primaryPressed },
}));
