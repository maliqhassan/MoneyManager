import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { useSyncStore } from '@/stores/syncStore';
import { makeStyles } from '@/theme';

/**
 * Explains a sync run that stopped because the server schema is older than
 * this app version (`server_not_ready`). Display only: queued changes stay
 * pending and the next sync retries as usual. No technical details shown.
 */
export function SyncServerUpdateNote() {
  const { t } = useTranslation();
  const styles = useStyles();
  const lastErrorCode = useSyncStore((s) => s.lastErrorCode);
  if (lastErrorCode !== 'server_not_ready') return null;

  return (
    <View style={styles.note} accessible accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Icon name="cloud-upload-outline" size={18} tone="warning" />
      <Text variant="bodySmall" tone="warning" style={styles.text}>
        {t('more.serverUpdateNeeded')}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.sm },
  text: { flex: 1 },
}));
