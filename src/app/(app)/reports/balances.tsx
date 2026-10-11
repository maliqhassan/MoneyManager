import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BalanceColumns } from '@/components/charts/BalanceColumns';
import { Card, ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { compareDates } from '@/domain/dates/calendar';
import { useRangeLabel } from '@/features/reports/components/ReportParts';
import { useBalanceHistory } from '@/features/reports/hooks';
import { useReportPeriod } from '@/features/reports/periodStore';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles } from '@/theme';

/**
 * Balance over the selected period for each active account, in its own
 * currency, derived from the opening balance and recorded transactions —
 * the same ledger as the current balance. Nothing before the
 * opening-balance date is shown.
 */
export default function BalanceHistoryScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const rangeLabel = useRangeLabel();
  const period = useReportPeriod();
  const query = useBalanceHistory(period.range);

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingState />;

  return (
    <Screen>
      <Text variant="bodySmall" tone="textSecondary">
        {rangeLabel(period.range)}
      </Text>
      {query.data.length === 0 ? (
        <Card>
          <Text variant="body" tone="textSecondary">
            {t('reports.balances.empty')}
          </Text>
        </Card>
      ) : (
        query.data.map((a) => {
          const fmt = (v: number | null) =>
            v === null ? '—' : formatter.money({ amountMinor: v, currency: a.currency });
          const firstKnown = a.series.points.find((p) => p.balanceMinor !== null);
          const opening = a.series.points.some((p) => p.balanceMinor === null);
          const described = a.series.points
            .map((p) =>
              t('reports.balances.a11yPoint', {
                date: formatter.date(p.date, 'medium'),
                amount: fmt(p.balanceMinor),
              }),
            )
            .join('; ');
          return (
            <Card key={a.accountId}>
              <View style={styles.body}>
                <View style={styles.header}>
                  <Text variant="heading" style={styles.flex} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text variant="amount">{fmt(a.series.endMinor)}</Text>
                </View>
                <BalanceColumns
                  points={a.series.points}
                  accessibilityLabel={`${t('reports.balances.a11yChart', { name: a.name })}: ${described}`}
                />
                <View style={styles.grid}>
                  <Stat label={t('reports.balances.start')} value={fmt(a.series.startMinor)} />
                  <Stat label={t('reports.balances.end')} value={fmt(a.series.endMinor)} />
                  <Stat
                    label={t('reports.balances.change')}
                    value={
                      a.series.changeMinor === null
                        ? '—'
                        : formatter.money(
                            { amountMinor: a.series.changeMinor, currency: a.currency },
                            { signDisplay: 'exceptZero' },
                          )
                    }
                  />
                  <Stat label={t('reports.balances.low')} value={fmt(a.series.lowMinor)} />
                  <Stat label={t('reports.balances.high')} value={fmt(a.series.highMinor)} />
                </View>
                {opening && firstKnown && compareDates(firstKnown.date, period.range.start) > 0 ? (
                  <Text variant="caption" tone="textMuted">
                    {t('reports.balances.beforeOpening', {
                      date: formatter.date(firstKnown.date, 'medium'),
                    })}
                  </Text>
                ) : null}
              </View>
            </Card>
          );
        })
      )}
      <Text variant="caption" tone="textMuted">
        {t('reports.balances.derivedNote')}
      </Text>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text variant="caption" tone="textSecondary">
        {label}
      </Text>
      <Text variant="bodySmall">{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  body: { gap: t.spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md },
  stat: { minWidth: 96, gap: 2 },
}));
