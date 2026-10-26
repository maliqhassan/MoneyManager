import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { makeStyles } from '@/theme';

import { SYNC_STATUS_ICON, syncDisplayStatus } from '../syncDisplay';

const BANNER_TEXT = {
  offline: 'states.offlineBanner',
  serverNotReady: 'states.serverUpdateBanner',
  authRequired: 'states.authRequiredBanner',
} as const;

/**
 * Unobtrusive banner shown only when sync cannot run (offline, server update
 * needed, session needs renewing), reassuring that data is safe locally.
 */
export function SyncStatusBanner() {
  const { t } = useTranslation();
  const styles = useStyles();
  const authStatus = useAuthStore((s) => s.status);
  const status = useSyncStore((s) =>
    syncDisplayStatus({
      phase: s.phase,
      pendingCount: s.pendingCount,
      failedCount: s.failedCount,
      lastSyncedAt: s.lastSyncedAt,
      lastErrorCode: s.lastErrorCode,
      isOnline: s.isOnline,
      authStatus,
    }),
  );
  // While a retry runs, keep explaining why sync is held back.
  const lastErrorCode = useSyncStore((s) => s.lastErrorCode);
  const shown =
    status === 'syncing' && lastErrorCode === 'server_not_ready' ? 'serverNotReady' : status;
  const localOnly = useSyncStore((s) => s.localOnly);
  if (localOnly) return null; // nothing syncs without an account
  if (shown !== 'offline' && shown !== 'serverNotReady' && shown !== 'authRequired') return null;

  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Icon name={SYNC_STATUS_ICON[shown]} size={18} tone="warning" />
      <Text variant="bodySmall" tone="warning" style={styles.text}>
        {t(BANNER_TEXT[shown])}
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
