import { type Href, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  Icon,
  IconButton,
  LoadingState,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { formatRateText } from '@/domain/fx/rateText';
import { sourceLabel } from '@/features/exchangeRates/components/RateNote';
import {
  useManualRateMutations,
  useRatesOverview,
  useRefreshRates,
} from '@/features/exchangeRates/hooks';
import { useFxRefreshStore } from '@/features/exchangeRates/refreshStore';
import { confirmAction } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';
import { useSyncStore } from '@/stores/syncStore';
import { makeStyles } from '@/theme';

/**
 * Exchange rates: what each of the user's currencies is worth in the base
 * currency today, where that rate comes from and how old it is, refresh
 * status, and the user's own (manual) rates. Works offline from the cache.
 */
export default function ExchangeRatesScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const overview = useRatesOverview();
  const refresh = useRefreshRates();
  const refreshing = useFxRefreshStore((s) => s.refreshing);
  const last = useFxRefreshStore((s) => s.last);
  const isOnline = useSyncStore((s) => s.isOnline);
  const { remove } = useManualRateMutations();

  if (overview.isLoading) return <LoadingState />;
  if (overview.error || !overview.data) {
    return (
      <Screen>
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      </Screen>
    );
  }
  const { base, rows, log, manual } = overview.data;
  const sep = formatter.separators;

  const outcomeText = (() => {
    if (!last) return null;
    if (last.status === 'failed') return t(`exchangeRates.outcome.${last.error}`);
    if (last.status === 'skipped') return t(`exchangeRates.outcome.${last.reason}`, { base });
    return t(`exchangeRates.outcome.${last.status}`);
  })();

  const addRate = (from?: string) =>
    router.push(
      (from
        ? `/settings/manual-rate?from=${from}&to=${base}`
        : `/settings/manual-rate?to=${base}`) as Href,
    );

  return (
    <Screen>
      <Text variant="body" tone="textSecondary">
        {t('exchangeRates.intro', { base })}
      </Text>

      <SectionHeader title={t('exchangeRates.currenciesTitle')} />
      <Card padding="none">
        {rows.length === 0 ? (
          <View style={styles.pad}>
            <Text variant="body" tone="textSecondary">
              {t('exchangeRates.noForeign', { base })}
            </Text>
          </View>
        ) : (
          rows.map((row, index) => (
            <View key={row.currency}>
              {index > 0 ? <Divider /> : null}
              <View style={styles.rateRow}>
                {row.rate ? (
                  <>
                    <Text variant="bodyStrong" selectable>
                      {t('exchangeRates.rateLine', {
                        from: row.currency,
                        rate: formatRateText(row.rate.rate, sep),
                        to: base,
                      })}
                    </Text>
                    <Text variant="caption" tone="textSecondary">
                      {t('exchangeRates.rateMeta', {
                        source: sourceLabel(t, row.rate.source.split('+')),
                        date: formatter.date(row.rate.rateDate, 'medium'),
                      })}
                      {row.rate.derivation === 'cross' ? ` · ${t('exchangeRates.derived')}` : ''}
                    </Text>
                    {row.rate.stale ? (
                      <View style={styles.inline}>
                        <Badge label={t('exchangeRates.stale')} tone="warning" />
                        <Text variant="caption" tone="textSecondary" style={styles.flex}>
                          {t('exchangeRates.staleHint')}
                        </Text>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <>
                    <View style={styles.inline}>
                      <Text variant="bodyStrong">{row.currency}</Text>
                      <Badge label={t('exchangeRates.noRate')} tone="warning" />
                    </View>
                    <Text variant="caption" tone="textSecondary">
                      {t('exchangeRates.noRateHint', { currency: row.currency })}
                    </Text>
                    <Button
                      label={t('exchangeRates.addRateFor', { currency: row.currency })}
                      variant="secondary"
                      size="md"
                      icon="add"
                      onPress={() => addRate(row.currency)}
                    />
                  </>
                )}
              </View>
            </View>
          ))
        )}
      </Card>

      <SectionHeader title={t('exchangeRates.statusTitle')} />
      <Card>
        <View style={styles.group}>
          <Text variant="body">
            {log.lastSuccessAt
              ? t('exchangeRates.lastUpdated', { when: formatter.dateTime(log.lastSuccessAt) })
              : t('exchangeRates.neverUpdated')}
          </Text>
          {outcomeText ? (
            <Text variant="bodySmall" tone="textSecondary" accessibilityLiveRegion="polite">
              {outcomeText}
            </Text>
          ) : !isOnline ? (
            <Text variant="bodySmall" tone="textSecondary">
              {t('exchangeRates.outcome.offline')}
            </Text>
          ) : null}
          <Button
            label={refreshing ? t('exchangeRates.refreshing') : t('exchangeRates.refresh')}
            icon="refresh"
            variant="secondary"
            loading={refreshing || refresh.isPending}
            disabled={!isOnline}
            onPress={() => refresh.mutate()}
          />
          <View style={styles.inline}>
            <Icon name="information-circle-outline" size={16} tone="textSecondary" />
            <Text variant="caption" tone="textSecondary" style={styles.flex}>
              {t('exchangeRates.attribution')}
            </Text>
          </View>
          <View style={styles.inline}>
            <Icon name="lock-closed-outline" size={16} tone="textSecondary" />
            <Text variant="caption" tone="textSecondary" style={styles.flex}>
              {t('exchangeRates.privacy')}
            </Text>
          </View>
        </View>
      </Card>

      <SectionHeader title={t('exchangeRates.manualTitle')} />
      <Text variant="bodySmall" tone="textSecondary">
        {t('exchangeRates.manualHint')}
      </Text>
      <Card padding="none">
        {manual.length === 0 ? (
          <View style={styles.pad}>
            <Text variant="body" tone="textSecondary">
              {t('exchangeRates.manualEmpty')}
            </Text>
          </View>
        ) : (
          manual.map((m, index) => {
            const line = t('exchangeRates.rateLine', {
              from: m.base,
              rate: formatRateText(m.rate, sep),
              to: m.quote,
            });
            const date = formatter.date(m.rateDate, 'medium');
            return (
              <View key={m.id}>
                {index > 0 ? <Divider /> : null}
                <View style={[styles.rateRow, styles.manualRow]}>
                  <View style={styles.flex}>
                    <Text variant="bodyStrong">{line}</Text>
                    <Text variant="caption" tone="textSecondary">
                      {t('exchangeRates.rateMeta', {
                        source: t('exchangeRates.sources.manual'),
                        date,
                      })}
                    </Text>
                  </View>
                  <IconButton
                    icon="trash-outline"
                    accessibilityLabel={`${t('exchangeRates.deleteRate')}: ${line}, ${date}`}
                    onPress={() =>
                      confirmAction(t, {
                        title: t('exchangeRates.deleteConfirmTitle'),
                        body: t('exchangeRates.deleteConfirmBody', {
                          from: m.base,
                          rate: formatRateText(m.rate, sep),
                          to: m.quote,
                          date,
                        }),
                        confirmLabel: t('exchangeRates.deleteRate'),
                        destructive: true,
                        onConfirm: () => remove.mutate(m.id),
                      })
                    }
                  />
                </View>
              </View>
            );
          })
        )}
      </Card>
      <Button label={t('exchangeRates.addRate')} icon="add" onPress={() => addRate()} />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  pad: { padding: t.spacing.md },
  group: { gap: t.spacing.sm },
  rateRow: { padding: t.spacing.md, gap: t.spacing.xs },
  manualRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
}));
