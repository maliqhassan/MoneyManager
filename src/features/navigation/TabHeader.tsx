import { type Href, router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, Text } from '@/components/ui';
import { tipAnchor } from '@/features/tips/FirstRunTips';
import { makeStyles } from '@/theme';

/** The Settings gear shown at the top right of every tab. */
export function SettingsButton() {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View ref={tipAnchor('settings')} collapsable={false} style={styles.gear}>
      <IconButton
        icon="settings-outline"
        accessibilityLabel={t('more.title')}
        testID="header-settings"
        onPress={() => router.push('/settings' as Href)}
      />
    </View>
  );
}

/**
 * Large in-page header for tabs that draw their own top area: a title (or
 * brand) with an optional line below, extra content on the right, and the
 * Settings gear. Pads for the status bar.
 */
export function TabHeader({
  title,
  subtitle,
  brand = false,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Shows the title as the app's wordmark (Home). */
  brand?: boolean;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.titles}>
        <Text
          variant={brand ? 'heading' : 'title'}
          tone={brand ? 'primary' : 'text'}
          accessibilityRole="header"
          numberOfLines={1}
          style={brand ? styles.brand : null}
        >
          {title}
        </Text>
        {typeof subtitle === 'string' ? (
          <Text variant="caption" tone="textSecondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      {right}
      <SettingsButton />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.gutter,
    paddingBottom: t.spacing.md,
    backgroundColor: t.colors.background,
  },
  titles: { flex: 1, gap: t.spacing.xxs },
  brand: { fontWeight: '800', letterSpacing: -0.3 },
  gear: {
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
}));
