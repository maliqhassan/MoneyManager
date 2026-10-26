import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { makeStyles } from '@/theme';

import { SYNC_STATUS_ICON, SYNC_STATUS_TONE, syncDisplayStatus } from '../syncDisplay';

/**
 * One-line sync status (syncing / waiting / up to date / offline / sign-in
 * needed / server update needed). When the session was rejected it adds a
 * reassurance that local changes are kept.
 */
export function SyncStatusLine() {
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
  return (
    <View style={styles.body}>
      <View style={styles.row} accessible accessibilityLiveRegion="polite">
        <Icon name={SYNC_STATUS_ICON[status]} size={20} tone={SYNC_STATUS_TONE[status]} />
        <Text variant="bodyStrong" style={styles.text}>
          {t(`sync.${status}`)}
        </Text>
      </View>
      {status === 'authRequired' ? (
        <Text variant="bodySmall" tone="warning">
          {t('sync.authRequiredBody')}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  body: { gap: t.spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  text: { flex: 1 },
}));
