import { Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  Button,
  Card,
  ChoiceChips,
  ErrorState,
  Icon,
  LoadingState,
  MultiChoiceChips,
  Screen,
  Text,
} from '@/components/ui';
import { compareDates } from '@/domain/dates/calendar';
import type { TransactionType } from '@/domain/enums';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { categoryDisplayName } from '@/features/categories/displayName';
import { buildExport } from '@/features/data/exportBuilder';
import { DateTimeField } from '@/features/transactions/components/DateTimeField';
import { useFormatter } from '@/i18n/FormatContext';
import { useRepositories } from '@/providers/DataProvider';
import { shareExport, type WrittenExport, writeExport } from '@/services/data/dataFiles';
import { makeStyles } from '@/theme';

const TYPES: readonly TransactionType[] = ['expense', 'income', 'refund', 'transfer'];

/**
 * Exports the user's own data (local database) as CSV or ZIP and hands it
 * to the system share sheet. Nothing is uploaded by MoneyManager.
 */
export default function ExportScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const repos = useRepositories();
  const accounts = useAccounts({ includeArchived: true });
  const [scope, setScope] = useState<'transactions' | 'all'>('transactions');
  const [dateMode, setDateMode] = useState<'all' | 'custom'>('all');
  const today = formatter.today();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [types, setTypes] = useState<TransactionType[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [written, setWritten] = useState<{
    file: WrittenExport;
    rows: number;
    pending: number;
  } | null>(null);

  if (accounts.isLoading) return <LoadingState />;
  if (accounts.error) {
    return (
      <Screen>
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      </Screen>
    );
  }

  const run = async () => {
    setBusy(true);
    setError(null);
    setWritten(null);
    try {
      const now = new Date().toISOString();
      const built = await buildExport(repos, {
        scope,
        filter: {
          from: dateMode === 'custom' ? from : null,
          to: dateMode === 'custom' ? to : null,
          accountIds,
          types,
        },
        categoryName: (c) => categoryDisplayName(t, c),
        dateDisplay: (d) => formatter.date(d, 'numeric'),
        baseCurrency: formatter.settings.baseCurrency,
        timeZone: formatter.settings.timeZone,
        appVersion: '0.1.0',
        now,
      });
      const file = writeExport(built, now.slice(0, 19).replace(/[:T]/g, '-'));
      setWritten({
        file,
        rows: built.tables[0]?.rows.length ?? 0,
        pending: built.manifest.pendingLocalChanges,
      });
      await shareExport(file, t('dataExport.shareTitle'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('dataExport.title') }} />
      <Text variant="body" tone="textSecondary">
        {t('dataExport.intro')}
      </Text>

      <View style={styles.group}>
        <ChoiceChips
          label={t('dataExport.scope')}
          value={scope}
          onChange={setScope}
          choices={(['transactions', 'all'] as const).map((value) => ({
            value,
            label: t(`dataExport.scopes.${value}`),
          }))}
        />
        <Text variant="caption" tone="textSecondary">
          {t(`dataExport.scopeHint.${scope}`)}
        </Text>
      </View>

      <View style={styles.group}>
        <ChoiceChips
          label={t('dataExport.dates')}
          value={dateMode}
          onChange={setDateMode}
          choices={(['all', 'custom'] as const).map((value) => ({
            value,
            label: t(`dataExport.dateModes.${value}`),
          }))}
        />
        {dateMode === 'custom' ? (
          <View style={styles.row}>
            <View style={styles.flex}>
              <DateTimeField
                label={t('dataExport.from')}
                date={from}
                time="00:00"
                showTime={false}
                onChange={({ date }) => {
                  setFrom(date);
                  if (compareDates(date, to) > 0) setTo(date);
                }}
              />
            </View>
            <View style={styles.flex}>
              <DateTimeField
                label={t('dataExport.to')}
                date={to}
                time="00:00"
                showTime={false}
                onChange={({ date }) => {
                  setTo(date);
                  if (compareDates(date, from) < 0) setFrom(date);
                }}
              />
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.group}>
        <MultiChoiceChips
          label={t('dataExport.accounts')}
          values={accountIds}
          onChange={setAccountIds}
          choices={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
        />
        <Text variant="caption" tone="textSecondary">
          {t('dataExport.accountsHint')}
        </Text>
      </View>

      <View style={styles.group}>
        <MultiChoiceChips
          label={t('dataExport.types')}
          values={types}
          onChange={setTypes}
          choices={TYPES.map((value) => ({ value, label: t(`dataExport.typeNames.${value}`) }))}
        />
        <Text variant="caption" tone="textSecondary">
          {t('dataExport.typesHint')}
        </Text>
      </View>

      <Card>
        <View style={styles.notice}>
          <Icon name="information-circle-outline" size={18} tone="textSecondary" />
          <Text variant="bodySmall" tone="textSecondary" style={styles.flex}>
            {t('dataExport.includes')}
          </Text>
        </View>
      </Card>

      {error ? <ErrorState error={error} /> : null}
      {written ? (
        <Card>
          <View style={styles.group}>
            <View style={styles.notice}>
              <Icon name="checkmark-circle-outline" size={18} tone="positive" />
              <Text variant="body" style={styles.flex} accessibilityLiveRegion="polite">
                {t('dataExport.done', {
                  file: written.file.fileName,
                  files: written.file.files.length,
                  rows: written.rows,
                })}
              </Text>
            </View>
            {written.pending > 0 ? (
              <Text variant="caption" tone="textSecondary">
                {t('dataExport.unsynced', { count: written.pending })}
              </Text>
            ) : null}
            <Button
              label={t('dataExport.shareAgain')}
              variant="secondary"
              size="md"
              onPress={() =>
                void shareExport(written.file, t('dataExport.shareTitle')).catch(setError)
              }
            />
          </View>
        </Card>
      ) : null}

      <Button
        label={busy ? t('dataExport.working') : t('dataExport.export')}
        icon="share-outline"
        loading={busy}
        onPress={() => void run()}
      />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  group: { gap: t.spacing.sm },
  row: { flexDirection: 'row', gap: t.spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 140 },
  notice: { flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' },
}));
