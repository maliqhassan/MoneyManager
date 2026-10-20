import { type Href, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

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
import { findCountry } from '@/domain/regional/countries';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { useFormatter } from '@/i18n/FormatContext';
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

/** Settings hub. Every row here works; unavailable features are labelled as such. */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const email = useAuthStore((s) => s.user?.email);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const sync = useSyncStore();
  const { syncEngine } = useData();
  const { requestSignOut } = useSignOut();
  const { settings } = formatter;

  const regionalSummary = [
    findCountry(settings.region)?.name,
    settings.baseCurrency,
    settings.timeZone,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen edges={[]}>
      <Card padding="none">
        <ListItem
          icon="wallet-outline"
          title={t('more.accounts')}
          subtitle={t('more.accountsHint')}
          onPress={() => router.push('/accounts')}
        />
        <Divider inset={64} />
        <ListItem
          icon="pricetags-outline"
          title={t('more.categories')}
          subtitle={t('more.categoriesHint')}
          onPress={() => router.push('/categories' as Href)}
        />
      </Card>

      <SectionHeader title={t('more.dataSection')} />
      <Card padding="none">
        <ListItem
          icon="document-text-outline"
          title={t('more.importCsv')}
          subtitle={t('more.importCsvHint')}
          onPress={() => router.push('/data/import' as Href)}
        />
        <Divider inset={64} />
        <ListItem
          icon="share-outline"
          title={t('more.exportData')}
          subtitle={t('more.exportDataHint')}
          onPress={() => router.push('/data/export' as Href)}
        />
      </Card>

      <SectionHeader title={t('more.preferencesSection')} />
      <Card padding="none">
        <ListItem
          icon="globe-outline"
          title={t('more.regional')}
          subtitle={regionalSummary}
          onPress={() => router.push('/settings/regional')}
        />
        <Divider inset={64} />
        <ListItem
          icon="swap-horizontal-outline"
          title={t('more.exchangeRates')}
          subtitle={t('more.exchangeRatesHint')}
          onPress={() => router.push('/settings/exchange-rates' as Href)}
        />
        <Divider inset={64} />
        <ListItem
          icon="notifications-outline"
          title={t('more.notifications')}
          subtitle={t('more.notificationsHint')}
          onPress={() => router.push('/settings/reminders' as Href)}
        />
      </Card>

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
            {`${t('more.lastSynced')}: ${
              sync.lastSyncedAt ? formatter.dateTime(sync.lastSyncedAt) : t('more.never')
            }`}
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
        {email ? (
          <>
            <ListItem icon="person-circle-outline" title={t('more.signedInAs', { email })} />
            <Divider inset={64} />
          </>
        ) : null}
        <ListItem
          icon="shield-checkmark-outline"
          title={t('more.privacy')}
          onPress={() => router.push('/settings/privacy')}
        />
        <Divider inset={64} />
        <ListItem
          icon="information-circle-outline"
          title={t('more.about')}
          onPress={() => router.push('/settings/about')}
        />
        <Divider inset={64} />
        <ListItem
          icon="log-out-outline"
          title={t('auth.signOut')}
          onPress={() => void requestSignOut()}
        />
      </Card>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  syncBody: { gap: t.spacing.sm },
}));
