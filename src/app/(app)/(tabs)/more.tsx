import Constants from 'expo-constants';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  Icon,
  ListItem,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import type { ThemeMode } from '@/domain/enums';
import { FormError } from '@/features/auth/components/FormError';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { formatDateTime } from '@/i18n/format';
import { getDeviceLocale } from '@/i18n/locale';
import { useData } from '@/providers/DataProvider';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { makeStyles } from '@/theme';

const THEME_OPTIONS: {
  mode: ThemeMode;
  labelKey: 'more.themeSystem' | 'more.themeLight' | 'more.themeDark';
}[] = [
  { mode: 'system', labelKey: 'more.themeSystem' },
  { mode: 'light', labelKey: 'more.themeLight' },
  { mode: 'dark', labelKey: 'more.themeDark' },
];

export default function MoreScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const email = useAuthStore((s) => s.user?.email);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const sync = useSyncStore();
  const { syncEngine } = useData();
  const { requestSignOut, requestDeleteAccount, busy } = useSignOut();
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const locale = getDeviceLocale();

  const confirmDelete = () =>
    Alert.alert(t('more.deleteAccount'), t('more.deleteAccountConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('more.deleteAccount'),
        style: 'destructive',
        onPress: () => void requestDeleteAccount(setDeleteError),
      },
    ]);

  return (
    <Screen edges={[]}>
      {email ? (
        <Text variant="bodySmall" tone="textSecondary">
          {t('more.signedInAs', { email })}
        </Text>
      ) : null}

      <SectionHeader title={t('more.appearance')} />
      <Card padding="none">
        {THEME_OPTIONS.map((option, index) => (
          <View key={option.mode}>
            {index > 0 ? <Divider inset={16} /> : null}
            <ListItem
              title={t(option.labelKey)}
              onPress={() => setThemeMode(option.mode)}
              showChevron={false}
              selected={themeMode === option.mode}
              accessibilityLabel={`${t('more.theme')}: ${t(option.labelKey)}`}
              trailing={themeMode === option.mode ? <Icon name="checkmark" tone="primary" /> : null}
            />
          </View>
        ))}
      </Card>

      <SectionHeader title={t('more.sync')} />
      <Card>
        <View style={styles.syncBody}>
          <Text variant="bodyStrong">{t(`sync.${sync.phase}`)}</Text>
          <Text variant="bodySmall" tone="textSecondary">
            {t('more.lastSynced')}:{' '}
            {sync.lastSyncedAt
              ? formatDateTime(sync.lastSyncedAt, locale.languageTag, locale.timeZone)
              : t('more.never')}
          </Text>
          {sync.pendingCount > 0 ? (
            <Text variant="bodySmall" tone="textSecondary">
              {t('more.pendingChanges', { count: sync.pendingCount })}
            </Text>
          ) : null}
          {sync.failedCount > 0 ? (
            <Text variant="bodySmall" tone="negative">
              {t('more.failedChanges', { count: sync.failedCount })}
            </Text>
          ) : null}
          {sync.conflictCount > 0 ? (
            <Text variant="bodySmall" tone="warning">
              {t('more.conflicts', { count: sync.conflictCount })}
            </Text>
          ) : null}
          <Button
            label={t('more.syncNow')}
            variant="secondary"
            size="md"
            icon="sync-outline"
            loading={sync.phase === 'syncing'}
            disabled={!sync.isOnline}
            onPress={() => void syncEngine.sync()}
          />
        </View>
      </Card>

      <SectionHeader title={t('more.account')} />
      <Card padding="none">
        <ListItem
          icon="log-out-outline"
          title={t('auth.signOut')}
          onPress={() => void requestSignOut()}
        />
        <Divider inset={64} />
        <ListItem
          icon="trash-outline"
          title={t('more.deleteAccount')}
          destructive
          onPress={confirmDelete}
        />
      </Card>
      <FormError error={deleteError} />
      {busy ? null : (
        <Text variant="caption" tone="textMuted" align="center">
          {t('more.version', { version: Constants.expoConfig?.version ?? '—' })}
        </Text>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  syncBody: { gap: t.spacing.sm },
}));
