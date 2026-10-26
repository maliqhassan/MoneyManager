import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { MonthlyColumns } from '@/components/charts/MonthlyColumns';
import { ShareBar } from '@/components/charts/ShareBar';
import {
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  MoneyText,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '@/components/ui';
import type { CurrencyCode } from '@/domain/currency/currencies';
import { type TrendPoint } from '@/domain/reports/aggregate';
import { STATUS_TONE } from '@/features/budgets/components/BudgetCard';
import { useCategoryName } from '@/features/categories/hooks';
import {
  ChangeLine,
  ExcludedNote,
  PeriodPicker,
  useMonthNames,
  useRangeLabel,
} from '@/features/reports/components/ReportParts';
import { ReportRow } from '@/features/reports/components/ReportRow';
import { openDrillDown } from '@/features/reports/drilldown';
import {
  useBalanceHistory,
  useBudgetVsActual,
  useCashFlowReport,
  useCategoryReport,
  useMerchantReport,
  useMonthlyTrend,
} from '@/features/reports/hooks';
import { useReportPeriod } from '@/features/reports/periodStore';
import { RateNote } from '@/features/exchangeRates/components/RateNote';
import { useFormatter } from '@/i18n/FormatContext';
import { TabHeader } from '@/features/navigation/TabHeader';
import { makeStyles, useTheme } from '@/theme';

const TOP_ROWS = 5;

/**
 * Reports: every number is computed by domain/reports from the local
 * database; charts only draw those numbers, and every value can be opened
 * to the exact transactions behind it. No sample data is ever shown.
 */
export default function ReportsScreen() {
  const { t } = useTranslation();
  const period = useReportPeriod();
  const styles = useStyles();
  return (
    <View style={styles.root}>
      <TabHeader title={t('tabs.reports')} />
      <Screen edges={[]}>
        <PeriodPicker period={period} />
        <View style={styles.sections}>
          <CashFlowSection />
          <TrendSection />
          <CategoriesSection />
          <MerchantsSection />
          <BudgetsSection />
          <BalancesSection />
        </View>
      </Screen>
    </View>
  );
}

function SectionSkeleton() {
  return <Skeleton height={120} radius={16} />;
}

function CashFlowSection() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const period = useReportPeriod();
  const query = useCashFlowReport(period);
  const base = formatter.settings.baseCurrency;
  const fmt = (amountMinor: number) => formatter.money({ amountMinor, currency: base });

  return (
    <View style={styles.section}>
      <SectionHeader title={t('reports.sections.cashFlow')} />
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <SectionSkeleton />
      ) : query.data.current.transactionCount === 0 &&
        query.data.current.excludedIncome.length === 0 ? (
        <Card>
          <EmptyState
            icon="bar-chart-outline"
            title={t('reports.emptyTitle')}
            description={t('reports.emptyBody')}
            actionLabel={t('reports.addTransaction')}
            onAction={() => router.push('/transactions/new?type=expense' as Href)}
          />
        </Card>
      ) : (
        (() => {
          const { current: c, previous: p } = query.data;
          const comparable = c.complete && p.complete;
          return (
            <Card>
              <View style={styles.body}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('reports.cashFlow.income')}: ${fmt(c.incomeMinor)}`}
                  onPress={() =>
                    openDrillDown({
                      kind: 'income',
                      title: t('reports.cashFlow.income'),
                      range: period.range,
                    })
                  }
                  style={styles.metric}
                >
                  <View style={styles.metricRow}>
                    <Text variant="body" tone="textSecondary">
                      {t('reports.cashFlow.income')}
                    </Text>
                    <MoneyText value={{ amountMinor: c.incomeMinor, currency: base }} />
                  </View>
                  <ChangeLine
                    current={c.incomeMinor}
                    previous={p.incomeMinor}
                    comparable={comparable}
                    currency={base}
                  />
                </Pressable>
                <Divider />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('reports.cashFlow.spending')}: ${fmt(c.spendingMinor)}`}
                  onPress={() =>
                    openDrillDown({
                      kind: 'spending',
                      title: t('reports.cashFlow.spending'),
                      range: period.range,
                    })
                  }
                  style={styles.metric}
                >
                  <View style={styles.metricRow}>
                    <Text variant="body" tone="textSecondary">
                      {t('reports.cashFlow.spending')}
                    </Text>
                    <MoneyText value={{ amountMinor: c.spendingMinor, currency: base }} />
                  </View>
                  <ChangeLine
                    current={c.spendingMinor}
                    previous={p.spendingMinor}
                    comparable={comparable}
                    currency={base}
                  />
                  {c.refundsMinor > 0 ? (
                    <Text variant="caption" tone="textMuted">
                      {t('reports.cashFlow.refunds', { amount: fmt(c.refundsMinor) })}
                    </Text>
                  ) : null}
                </Pressable>
                <Divider />
                <View style={styles.metricRow}>
                  <Text variant="bodyStrong">{t('reports.cashFlow.net')}</Text>
                  <MoneyText
                    value={{ amountMinor: c.netMinor, currency: base }}
                    colorBySign
                    format={{ signDisplay: 'exceptZero' }}
                    variant="bodyStrong"
                  />
                </View>
                <View style={styles.metricRow}>
                  <Text variant="body" tone="textSecondary">
                    {t('reports.cashFlow.savingsRate')}
                  </Text>
                  <Text variant="body">
                    {c.savingsRateBasisPoints !== null
                      ? formatter.percent(c.savingsRateBasisPoints, 0)
                      : '—'}
                  </Text>
                </View>
                {c.savingsRateBasisPoints === null ? (
                  <Text variant="caption" tone="textMuted">
                    {c.complete
                      ? t('reports.cashFlow.savingsRateNone')
                      : t('reports.cashFlow.savingsRateIncomplete')}
                  </Text>
                ) : null}
                <Text variant="caption" tone="textMuted">
                  {t('reports.cashFlow.transactions', { count: c.transactionCount })}
                </Text>
                <ExcludedNote excluded={[...c.excludedIncome, ...c.excludedSpending]} />
                <RateNote note={query.data.fx} showMissing={false} />
                <Text variant="caption" tone="textMuted">
                  {t('reports.cashFlow.savingsNote')}
                </Text>
              </View>
            </Card>
          );
        })()
      )}
    </View>
  );
}

function TrendSection() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const period = useReportPeriod();
  const months = useMonthNames();
  const query = useMonthlyTrend(period.range.end);
  const [selected, setSelected] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);
  const base = formatter.settings.baseCurrency;
  const fmt = (amountMinor: number) => formatter.money({ amountMinor, currency: base });
  const describe = (p: TrendPoint) =>
    p.status === 'unavailable'
      ? t('reports.trend.a11yNoData', { month: months.long(p.month) })
      : `${t('reports.trend.a11yMonth', {
          month: months.long(p.month),
          income: fmt(p.summary.incomeMinor),
          spending: fmt(p.summary.spendingMinor),
          net: fmt(p.summary.netMinor),
        })}${p.summary.complete ? '' : `. ${t('reports.trend.a11yIncomplete', { month: months.long(p.month) })}`}`;
  const points = query.data ?? [];
  const current = points.find((p) => p.month === selected) ?? points[points.length - 1];

  return (
    <View style={styles.section}>
      <SectionHeader
        title={t('reports.sections.trend')}
        actionLabel={asTable ? t('reports.trend.showChart') : t('reports.trend.showTable')}
        onAction={() => setAsTable((v) => !v)}
      />
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <SectionSkeleton />
      ) : (
        <Card>
          <View style={styles.body}>
            {asTable ? (
              <View accessibilityRole="list">
                <View style={styles.tableRow}>
                  {[
                    t('reports.trend.month'),
                    t('reports.legend.income'),
                    t('reports.legend.spending'),
                    t('reports.cashFlow.net'),
                  ].map((h) => (
                    <Text key={h} variant="caption" tone="textSecondary" style={styles.tableCell}>
                      {h}
                    </Text>
                  ))}
                </View>
                {[...points].reverse().map((p) => (
                  <View
                    key={p.month}
                    style={styles.tableRow}
                    accessible
                    accessibilityLabel={describe(p)}
                  >
                    <Text variant="bodySmall" style={styles.tableCell}>
                      {months.short(p.month)} {p.month.slice(0, 4)}
                    </Text>
                    {p.status === 'unavailable' ? (
                      <Text
                        variant="bodySmall"
                        tone="textMuted"
                        style={[styles.tableCell, styles.tableWide]}
                      >
                        {t('reports.trend.noData')}
                      </Text>
                    ) : (
                      <>
                        <Text variant="bodySmall" style={styles.tableCell}>
                          {fmt(p.summary.incomeMinor)}
                        </Text>
                        <Text variant="bodySmall" style={styles.tableCell}>
                          {fmt(p.summary.spendingMinor)}
                        </Text>
                        <Text variant="bodySmall" style={styles.tableCell}>
                          {fmt(p.summary.netMinor)}
                          {p.summary.complete ? '' : ' *'}
                        </Text>
                      </>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <>
                <Text variant="caption" tone="textMuted">
                  {t('reports.trend.chartLabel')}
                </Text>
                <MonthlyColumns
                  points={points}
                  monthLabel={(p) => months.short(p.month)}
                  describe={describe}
                  selected={current?.month ?? null}
                  onSelect={(p) => setSelected(p.month)}
                />
                {current ? (
                  <Text variant="bodySmall" accessibilityLiveRegion="polite">
                    {current.status === 'unavailable'
                      ? `${months.long(current.month)} — ${t('reports.trend.noData')}`
                      : t('reports.trend.selected', {
                          month: months.long(current.month),
                          income: fmt(current.summary.incomeMinor),
                          spending: fmt(current.summary.spendingMinor),
                          net: fmt(current.summary.netMinor),
                        })}
                  </Text>
                ) : null}
                <Text variant="caption" tone="textMuted">
                  {t('reports.trend.tapHint')}
                </Text>
              </>
            )}
            <ExcludedNote
              excluded={mergeExcluded(
                points.flatMap((p) => [...p.summary.excludedIncome, ...p.summary.excludedSpending]),
              )}
            />
          </View>
        </Card>
      )}
    </View>
  );
}

/** Sums excluded amounts per currency (for one combined notice). */
function mergeExcluded(list: readonly { currency: CurrencyCode; amountMinor: number }[]) {
  const map = new Map<CurrencyCode, number>();
  for (const e of list) map.set(e.currency, (map.get(e.currency) ?? 0) + e.amountMinor);
  return [...map.entries()]
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function CategoriesSection() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const categoryName = useCategoryName();
  const period = useReportPeriod();
  const query = useCategoryReport(period);
  const base = formatter.settings.baseCurrency;

  return (
    <View style={styles.section}>
      <SectionHeader
        title={t('reports.sections.categories')}
        actionLabel={
          query.data && query.data.current.items.length > TOP_ROWS ? t('reports.seeAll') : undefined
        }
        onAction={() => router.push('/reports/categories' as Href)}
      />
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <SectionSkeleton />
      ) : query.data.current.items.length === 0 ? (
        <Card>
          <Text variant="body" tone="textSecondary">
            {t('reports.categories.empty')}
          </Text>
          <ExcludedNote excluded={query.data.current.excluded} />
        </Card>
      ) : (
        <Card padding="none">
          {query.data.current.items.slice(0, TOP_ROWS).map((item, index) => {
            const category = item.categoryId
              ? query.data.categoriesById.get(item.categoryId)
              : undefined;
            const name = category ? categoryName(category) : t('reports.categories.uncategorized');
            return (
              <View key={item.categoryId ?? 'none'}>
                {index > 0 ? <Divider inset={16} /> : null}
                <ReportRow
                  title={name}
                  amount={formatter.money({ amountMinor: item.spendingMinor, currency: base })}
                  detail={
                    item.shareBasisPoints !== null
                      ? t('reports.categories.share', {
                          percent: formatter.percent(item.shareBasisPoints, 0),
                        })
                      : null
                  }
                  barBasisPoints={item.shareBasisPoints ?? 0}
                  onPress={() =>
                    openDrillDown({
                      kind: 'category',
                      title: name,
                      range: period.range,
                      categoryId: item.categoryId,
                      includeSubcategories: true,
                    })
                  }
                />
              </View>
            );
          })}
          <View style={styles.cardFooter}>
            <ExcludedNote excluded={query.data.current.excluded} />
          </View>
        </Card>
      )}
    </View>
  );
}

function MerchantsSection() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const period = useReportPeriod();
  const query = useMerchantReport(period);
  const base = formatter.settings.baseCurrency;

  return (
    <View style={styles.section}>
      <SectionHeader
        title={t('reports.sections.merchants')}
        actionLabel={
          query.data && query.data.current.items.length > TOP_ROWS ? t('reports.seeAll') : undefined
        }
        onAction={() => router.push('/reports/merchants' as Href)}
      />
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <SectionSkeleton />
      ) : query.data.current.items.length === 0 ? (
        <Card>
          <Text variant="body" tone="textSecondary">
            {t('reports.merchants.empty')}
          </Text>
        </Card>
      ) : (
        <Card padding="none">
          {query.data.current.items.slice(0, TOP_ROWS).map((m, index) => {
            const name = m.merchantKey
              ? (query.data.names[m.merchantKey] ?? m.merchantKey)
              : t('reports.merchants.none');
            return (
              <View key={m.merchantKey ?? 'none'}>
                {index > 0 ? <Divider inset={16} /> : null}
                <ReportRow
                  title={name}
                  amount={formatter.money({ amountMinor: m.spendingMinor, currency: base })}
                  detail={t('reports.merchants.count', { count: m.transactionCount })}
                  barBasisPoints={m.shareBasisPoints ?? 0}
                  onPress={() =>
                    openDrillDown({
                      kind: 'merchant',
                      title: name,
                      range: period.range,
                      merchantKey: m.merchantKey,
                    })
                  }
                />
              </View>
            );
          })}
          <View style={styles.cardFooter}>
            <ExcludedNote excluded={query.data.current.excluded} />
          </View>
        </Card>
      )}
    </View>
  );
}

function BudgetsSection() {
  const { t } = useTranslation();
  const styles = useStyles();
  const theme = useTheme();
  const formatter = useFormatter();
  const rangeLabel = useRangeLabel();
  const period = useReportPeriod();
  const query = useBudgetVsActual(period.range);

  return (
    <View style={styles.section}>
      <SectionHeader title={t('reports.sections.budgets')} />
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <SectionSkeleton />
      ) : query.data.length === 0 ? (
        <Card>
          <Text variant="body" tone="textSecondary">
            {t('reports.budgets.empty')}
          </Text>
        </Card>
      ) : (
        <Card padding="none">
          {query.data
            .flatMap(({ item, periods }) => periods.map((entry) => ({ item, ...entry })))
            .map(({ item, period: p, coverage }, index) => {
              const fmt = (amountMinor: number) =>
                formatter.money({ amountMinor, currency: item.budget.currency });
              return (
                <View key={`${item.budget.id}:${p.start}`}>
                  {index > 0 ? <Divider inset={16} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(`/budgets/${item.budget.id}` as Href)}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && { backgroundColor: theme.colors.surfaceMuted },
                    ]}
                  >
                    <View style={styles.rowHeader}>
                      <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>
                        {item.budget.name}
                      </Text>
                      <Badge label={t(`budgets.status.${p.status}`)} tone={STATUS_TONE[p.status]} />
                    </View>
                    <Text variant="body">
                      {t('budgets.spentOf', {
                        spent: fmt(Math.max(0, p.spentMinor)),
                        budget: fmt(p.availableMinor),
                      })}
                    </Text>
                    <ShareBar valueBasisPoints={p.usedBasisPoints} />
                    <Text
                      variant="caption"
                      tone={p.remainingMinor < 0 ? 'negative' : 'textSecondary'}
                    >
                      {formatter.percent(p.usedBasisPoints, 0)} ·{' '}
                      {p.remainingMinor >= 0
                        ? t('budgets.remaining', { amount: fmt(p.remainingMinor) })
                        : t('budgets.over', { amount: fmt(-p.remainingMinor) })}
                    </Text>
                    <Text variant="caption" tone="textMuted">
                      {coverage === 'partial'
                        ? t('reports.budgets.partial', { range: rangeLabel(p) })
                        : t('reports.budgets.period', { range: rangeLabel(p) })}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          <View style={styles.cardFooter}>
            <Text variant="caption" tone="textMuted">
              {t('reports.budgets.noProration')}
            </Text>
          </View>
        </Card>
      )}
    </View>
  );
}

function BalancesSection() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const period = useReportPeriod();
  const query = useBalanceHistory(period.range);

  return (
    <View style={styles.section}>
      <SectionHeader
        title={t('reports.sections.balances')}
        actionLabel={query.data && query.data.length > 0 ? t('reports.seeAll') : undefined}
        onAction={() => router.push('/reports/balances' as Href)}
      />
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <SectionSkeleton />
      ) : query.data.length === 0 ? (
        <Card>
          <Text variant="body" tone="textSecondary">
            {t('reports.balances.empty')}
          </Text>
        </Card>
      ) : (
        <Card padding="none">
          {query.data.map((a, index) => {
            const fmt = (v: number | null) =>
              v === null ? '—' : formatter.money({ amountMinor: v, currency: a.currency });
            return (
              <View key={a.accountId}>
                {index > 0 ? <Divider inset={16} /> : null}
                <View style={styles.row} accessible>
                  <View style={styles.rowHeader}>
                    <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>
                      {a.name}
                    </Text>
                    <Text variant="amount">{fmt(a.series.endMinor)}</Text>
                  </View>
                  <Text variant="caption" tone="textSecondary">
                    {t('reports.balances.start')} {fmt(a.series.startMinor)} ·{' '}
                    {t('reports.balances.change')}{' '}
                    {a.series.changeMinor === null
                      ? '—'
                      : formatter.money(
                          { amountMinor: a.series.changeMinor, currency: a.currency },
                          { signDisplay: 'exceptZero' },
                        )}
                  </Text>
                </View>
              </View>
            );
          })}
          <View style={styles.cardFooter}>
            <Text variant="caption" tone="textMuted">
              {t('reports.balances.derivedNote')}
            </Text>
          </View>
        </Card>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.background },
  sections: { gap: t.spacing.xl },
  section: { gap: t.spacing.sm },
  body: { gap: t.spacing.sm },
  metric: { gap: t.spacing.xxs, minHeight: t.minTouchTarget, justifyContent: 'center' },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: t.spacing.md,
    flexWrap: 'wrap',
  },
  row: {
    gap: t.spacing.xs,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    minHeight: t.minTouchTarget,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  flex: { flex: 1 },
  cardFooter: { paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.md, gap: t.spacing.xs },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  tableCell: { flex: 1 },
  tableWide: { flex: 3 },
}));
