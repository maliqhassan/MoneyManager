import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, View } from 'react-native';

import { Icon, type IconName, Text } from '@/components/ui';
import { tipAnchor } from '@/features/tips/FirstRunTips';
import { useKeyboardVisible } from '@/hooks/useKeyboard';
import { MAX_FONT_SCALE_DENSE, makeStyles } from '@/theme';

export interface TabIcons {
  icon: IconName;
  activeIcon: IconName;
}

export interface TabAction {
  /** Route rendered as an action button instead of a tab (it never becomes focused). */
  routeName: string;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}

export interface AppTabBarProps extends BottomTabBarProps {
  icons: Readonly<Record<string, TabIcons>>;
  action?: TabAction;
}

/**
 * Bottom navigation: white surface with a hairline top border, a small tinted
 * indicator behind the active icon, and labels that are always shown. Sits
 * in the layout (never over content) and pads for the gesture / navigation
 * bar. Hidden while the keyboard is open so it never covers a focused field
 * or gets pushed above the keyboard.
 */
export function AppTabBar({
  state,
  descriptors,
  navigation,
  insets,
  icons,
  action,
}: AppTabBarProps) {
  const styles = useStyles();
  const keyboardVisible = useKeyboardVisible();
  if (keyboardVisible) return null;

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
      accessibilityRole="tablist"
      testID="app-tab-bar"
    >
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]?.options;
        const label = typeof options?.title === 'string' ? options.title : route.name;

        if (action && route.name === action.routeName) {
          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
              onPress={action.onPress}
              ref={tipAnchor('add')}
              style={styles.item}
            >
              {({ pressed }) => (
                <View style={[styles.fab, pressed && styles.fabPressed]}>
                  <Icon name="add" size={28} tone="onPrimary" />
                </View>
              )}
            </Pressable>
          );
        }

        const focused = state.index === index;
        const tabIcons = icons[route.name];
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={options?.tabBarAccessibilityLabel ?? label}
            accessibilityState={{ selected: focused }}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            testID={`tab-${route.name}`}
            ref={route.name === 'reports' ? tipAnchor('reports') : undefined}
            style={styles.item}
          >
            {({ pressed }) => (
              <>
                {/* Active tab: a short brand bar on the top edge, plus colour and weight. */}
                <View style={[styles.activeBar, focused && styles.activeBarOn]} />
                <View style={[styles.indicator, pressed && styles.indicatorPressed]}>
                  {tabIcons ? (
                    <Icon
                      name={focused ? tabIcons.activeIcon : tabIcons.icon}
                      size={24}
                      tone={focused ? 'primary' : 'textMuted'}
                    />
                  ) : null}
                </View>
                <Text
                  variant="caption"
                  tone={focused ? 'primary' : 'textMuted'}
                  style={[styles.label, focused && styles.labelActive]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_FONT_SCALE_DENSE}
                >
                  {label}
                </Text>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  bar: {
    flexDirection: 'row',
    backgroundColor: t.colors.tabBar,
    ...t.elevation.bar,
  },
  item: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: t.spacing.xxs,
    paddingBottom: t.spacing.sm,
  },
  activeBar: {
    width: 20,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    marginBottom: t.spacing.xs + t.spacing.xxs,
  },
  activeBarOn: { backgroundColor: t.colors.primary },
  indicator: {
    width: 48,
    height: 28,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorPressed: { backgroundColor: t.colors.surfaceMuted },
  // Raised round + above the bar: the app's main action.
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginTop: -t.spacing.lg - t.spacing.xs,
    backgroundColor: t.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: t.colors.tabBar,
    ...t.elevation.brand,
  },
  fabPressed: { backgroundColor: t.colors.primaryPressed },
  label: { paddingHorizontal: t.spacing.xxs },
  labelActive: { fontWeight: '600' },
}));
