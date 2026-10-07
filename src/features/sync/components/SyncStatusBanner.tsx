import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { useSyncStore } from '@/stores/syncStore';
import { makeStyles } from '@/theme';

/** Unobtrusive banner shown only while offline, reassuring that data is safe locally. */
export function SyncStatusBanner() {
  const { t } = useTranslation();
  const styles = useStyles();
  const isOnline = useSyncStore((s) => s.isOnline);
  if (isOnline) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Icon name="cloud-offline-outline" size={18} tone="warning" />
      <Text variant="bodySmall" tone="warning" style={styles.text}>
        {t('states.offlineBanner')}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    backgroundColor: t.colors.warningMuted,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  text: { flex: 1 },
}));
