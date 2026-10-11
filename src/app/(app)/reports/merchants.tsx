import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';

import { Divider, ErrorState, LoadingState, Text } from '@/components/ui';
import { ExcludedNote, useRangeLabel } from '@/features/reports/components/ReportParts';
import { ReportRow } from '@/features/reports/components/ReportRow';
import { openDrillDown } from '@/features/reports/drilldown';
import { useMerchantReport } from '@/features/reports/hooks';
import { useReportPeriod } from '@/features/reports/periodStore';
import { useFormatter } from '@/i18n/FormatContext';
import type { MerchantTotal } from '@/domain/reports/aggregate';
import { makeStyles } from '@/theme';

/**
 * All merchants for the selected period (virtualised). Merchants are grouped
 * by the app's existing name normalisation only — nothing is fuzzily merged.
 */
export default function MerchantReportScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const rangeLabel = useRangeLabel();
  const period = useReportPeriod();
  const query = useMerchantReport(period);
  const base = formatter.settings.baseCurrency;
  const fmt = (amountMinor: number) => formatter.money({ amountMinor, currency: base });

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingState />;
  const { current, previous, names } = query.data;
  const comparable = current.complete && previous.complete;

  const renderItem = ({ item }: { item: MerchantTotal }) => {
    const name = item.merchantKey
      ? (names[item.merchantKey] ?? item.merchantKey)
      : t('reports.merchants.none');
    const before =
      previous.items.find((p) => p.merchantKey === item.merchantKey)?.spendingMinor ?? 0;
    return (
      <ReportRow
        title={name}
        amount={fmt(item.spendingMinor)}
        detail={[
          t('reports.merchants.count', { count: item.transactionCount }),
          comparable ? t('reports.categories.previous', { amount: fmt(before) }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        barBasisPoints={item.shareBasisPoints ?? 0}
        onPress={() =>
          openDrillDown({
            kind: 'merchant',
            title: name,
            range: period.range,
            merchantKey: item.merchantKey,
          })
        }
      />
    );
  };

  return (
    <FlatList
      style={styles.list}
      data={current.items}
      keyExtractor={(m) => m.merchantKey ?? 'none'}
      renderItem={renderItem}
      ItemSeparatorComponent={() => <Divider inset={16} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text variant="bodySmall" tone="textSecondary">
            {rangeLabel(period.range)} · {fmt(current.totalMinor)}
          </Text>
          <ExcludedNote excluded={current.excluded} />
        </View>
      }
      ListEmptyComponent={
        <Text variant="body" tone="textSecondary" style={styles.header}>
          {t('reports.merchants.empty')}
        </Text>
      }
      initialNumToRender={20}
      windowSize={7}
    />
  );
}

const useStyles = makeStyles((t) => ({
  list: { backgroundColor: t.colors.background },
  header: { padding: t.spacing.lg, gap: t.spacing.xs },
}));
