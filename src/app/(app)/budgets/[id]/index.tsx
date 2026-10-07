import { type Href, router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  ProgressBar,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import type { CurrencyCode } from '@/domain/currency/currencies';
import { STATUS_TONE, usePeriodLabel } from '@/features/budgets/components/BudgetCard';
import {
  useBudgetMutations,
  useBudgetOverview,
  useBudgetSpendingLines,
} from '@/features/budgets/hooks';
import { useCategoryName } from '@/features/categories/hooks';
import { confirmAction, toastSaved } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles } from '@/theme';

/** Budget detail: progress, pace, rollover, category breakdown and history. */
export default function BudgetDetailScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const categoryName = useCategoryName();
  const periodLabel = usePeriodLabel();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const query = useBudgetOverview(id);
  const current = query.data?.evaluation.current;
  const lines = useBudgetSpendingLines(id, current?.start ?? '', current?.end ?? '');
  const { setArchived } = useBudgetMutations();

  // Breakdown by category (in each transaction's currency; never converted here).
  const breakdown = useMemo(() => {
    const totals = new Map<string, { label: string; currency: CurrencyCode; spent: number }>();
    for (const l of lines.data ?? []) {
      const key = `${l.categoryId ?? 'none'}:${l.currency}`;
      const label = l.categoryName
        ? categoryName({ name: l.categoryName, systemKey: l.categorySystemKey })
        : t('budgets.detail.uncategorized');
      const prev = totals.get(key);
      totals.set(key, { label, currency: l.currency, spent: (prev?.spent ?? 0) - l.amountMinor });
    }
    return [...totals.values()].sort((a, b) => b.spent - a.spent);
  }, [lines.data, categoryName, t]);

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading) return <LoadingState />;
  const item = query.data;
  if (!item || !current) {
    return <EmptyState icon="alert-circle-outline" title={t('states.notFound')} />;
  }

  const { budget, evaluation } = item;
  const fmt = (amountMinor: number) => formatter.money({ amountMinor, currency: budget.currency });
  const past = evaluation.periods.filter((p) => p.phase === 'past').reverse();
  const multiCurrency = new Set(breakdown.map((b) => b.currency)).size > 1;
  const archive = () =>
    confirmAction(t, {
      title: t('budgets.confirmArchive.title'),
      body: t('budgets.confirmArchive.body'),
      confirmLabel: t('budgets.actions.archive'),
      onConfirm: () =>
        setArchived.mutate(
          { id, archived: true },
          {
            onSuccess: () => {
              toastSaved(t, t('budgets.toast.archived'));
              router.back();
            },
          },
        ),
    });

  const paceText =
    current.phase === 'upcoming'
      ? t('budgets.pace.upcoming', { date: formatter.date(current.start, 'medium') })
      : current.phase === 'past'
        ? t('budgets.pace.ended')
        : current.aheadOfPace
          ? t('budgets.pace.ahead')
          : t('budgets.pace.within');

  return (
    <Screen>
      <Stack.Screen options={{ title: budget.name }} />

      <Card>
        <View style={styles.body}>
          <View style={styles.header}>
            <View style={styles.flex}>
              <Text variant="heading">{budget.name}</Text>
              <Text variant="bodySmall" tone="textSecondary">
                {periodLabel(current)}
                {budget.periodType !== 'custom' || current.phase === 'current'
                  ? ` · ${t('budgets.days.remaining', { count: current.daysRemaining })}`
                  : ''}
              </Text>
            </View>
            <Badge
              label={t(`budgets.status.${current.status}`)}
              tone={STATUS_TONE[current.status]}
            />
          </View>
          <Text variant="amountLarge">{fmt(Math.max(0, current.spentMinor))}</Text>
          <Text variant="body" tone="textSecondary">
            {t('budgets.spentOf', {
              spent: fmt(Math.max(0, current.spentMinor)),
              budget: fmt(current.availableMinor),
            })}
          </Text>
          <ProgressBar
            valueBasisPoints={current.usedBasisPoints}
            tone={STATUS_TONE[current.status]}
            accessibilityLabel={t('budgets.a11y.progress', { name: budget.name })}
            height={10}
          />
          <Divider />
          <Row label={t('budgets.detail.budgeted')} value={fmt(current.limitMinor)} />
          {current.carryInMinor > 0 ? (
            <Row label={t('budgets.detail.rolledOver')} value={`+${fmt(current.carryInMinor)}`} />
          ) : null}
          <Row label={t('budgets.detail.available')} value={fmt(current.availableMinor)} />
          <Row label={t('budgets.detail.spent')} value={fmt(current.spentMinor)} />
          <Row
            label={t('budgets.detail.remaining')}
            value={fmt(current.remainingMinor)}
            negative={current.remainingMinor < 0}
          />
          <Text variant="caption" tone="textSecondary">
            {current.rolloverEnabled
              ? t('budgets.detail.rolloverOn')
              : budget.periodType === 'custom'
                ? ''
                : t('budgets.detail.rolloverOff')}
          </Text>
        </View>
      </Card>

      <SectionHeader title={t('budgets.detail.pace')} />
      <Card>
        <View style={styles.body}>
          <Text variant="body">{paceText}</Text>
          {current.phase === 'current' ? (
            <>
              <Text variant="bodySmall" tone="textSecondary">
                {t('budgets.days.elapsed', { day: current.daysElapsed, total: current.daysTotal })}
              </Text>
              <Text variant="bodySmall" tone="textSecondary">
                {t('budgets.pace.expected', { amount: fmt(current.expectedSpentMinor) })}
              </Text>
              {current.averageDailySpentMinor !== null ? (
                <Text variant="bodySmall" tone="textSecondary">
                  {t('budgets.pace.averagePerDay', {
                    amount: fmt(current.averageDailySpentMinor),
                  })}
                </Text>
              ) : null}
              {current.dailyAllowanceMinor !== null ? (
                <Text variant="bodySmall" tone="textSecondary">
                  {t('budgets.pace.perDay', { amount: fmt(current.dailyAllowanceMinor) })}
                </Text>
              ) : null}
            </>
          ) : null}
          <Text variant="caption" tone="textMuted">
            {t('planning.metricNote')}
          </Text>
        </View>
      </Card>

      {item.missingRates.length > 0 ? (
        <View style={styles.warning}>
          <Icon name="information-circle-outline" size={18} tone="warning" />
          <Text variant="bodySmall" tone="textSecondary" style={styles.flex}>
            {t('planning.incompleteRates', { currencies: item.missingRates.join(', ') })}
          </Text>
        </View>
      ) : null}

      <Button
        label={t('budgets.detail.viewTransactions')}
        icon="list-outline"
        variant="secondary"
        onPress={() =>
          router.push(`/budgets/${id}/transactions?from=${current.start}&to=${current.end}` as Href)
        }
      />

      {(!budget.categoryId || breakdown.length > 1) && breakdown.length > 0 ? (
        <>
          <SectionHeader title={t('budgets.detail.breakdown')} />
          <Card>
            <View style={styles.body}>
              {breakdown.map((b) => (
                <Row
                  key={`${b.label}:${b.currency}`}
                  label={b.label}
                  value={formatter.money({ amountMinor: b.spent, currency: b.currency })}
                />
              ))}
              {multiCurrency ? (
                <Text variant="caption" tone="textSecondary">
                  {t('budgets.detail.amountsInOwnCurrency')}
                </Text>
              ) : null}
            </View>
          </Card>
        </>
      ) : null}

      {budget.periodType !== 'custom' ? (
        <>
          <SectionHeader title={t('budgets.detail.history')} />
          {past.length === 0 ? (
            <Text variant="body" tone="textSecondary">
              {t('budgets.detail.historyEmpty')}
            </Text>
          ) : (
            <Card padding="none">
              {past.slice(0, 24).map((p, index) => (
                <View key={p.start}>
                  {index > 0 ? <Divider inset={16} /> : null}
                  <View style={styles.historyRow}>
                    <View style={styles.flex}>
                      <Text variant="body">{periodLabel(p)}</Text>
                      <Text variant="bodySmall" tone="textSecondary">
                        {t('budgets.spentOf', {
                          spent: fmt(Math.max(0, p.spentMinor)),
                          budget: fmt(p.availableMinor),
                        })}
                        {p.carryInMinor > 0
                          ? ` · ${t('budgets.detail.carriedIn', { amount: fmt(p.carryInMinor) })}`
                          : ''}
                      </Text>
                    </View>
                    <Badge label={t(`budgets.status.${p.status}`)} tone={STATUS_TONE[p.status]} />
                  </View>
                </View>
              ))}
            </Card>
          )}
        </>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={t('budgets.actions.edit')}
          icon="create-outline"
          variant="secondary"
          onPress={() => router.push(`/budgets/${id}/edit` as Href)}
        />
        {budget.isArchived ? (
          <Button
            label={t('budgets.actions.restore')}
            icon="arrow-undo-outline"
            variant="secondary"
            loading={setArchived.isPending}
            onPress={() =>
              setArchived.mutate(
                { id, archived: false },
                { onSuccess: () => toastSaved(t, t('budgets.toast.restored')) },
              )
            }
          />
        ) : (
          <Button
            label={t('budgets.actions.archive')}
            icon="archive-outline"
            variant="ghost"
            onPress={archive}
          />
        )}
        {setArchived.error ? <ErrorState error={setArchived.error} /> : null}
      </View>
    </Screen>
  );
}

function Row({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text variant="body" tone="textSecondary" style={styles.flex}>
        {label}
      </Text>
      <Text variant="amount" tone={negative ? 'negative' : 'text'}>
        {value}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  body: { gap: t.spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  warning: { flexDirection: 'row', gap: t.spacing.xs, alignItems: 'flex-start' },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    padding: t.spacing.lg,
    minHeight: t.minTouchTarget,
  },
  actions: { gap: t.spacing.sm },
}));
