import { type Href, router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  ChoiceChips,
  Divider,
  EmptyState,
  ErrorState,
  Icon,
  MoneyText,
  Skeleton,
  Text,
} from '@/components/ui';
import {
  CASHFLOW_HORIZONS,
  type CashflowHorizon,
  type ExpectedItem,
} from '@/domain/planning/cashflow';
import { scheduleOf } from '@/domain/planning/recurring';
import { RateNote } from '@/features/exchangeRates/components/RateNote';
import { confirmAction, toastSaved } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';
import type { RecurringRuleItem } from '@/repositories/types';
import { useSyncStore } from '@/stores/syncStore';
import { makeStyles, useTheme } from '@/theme';

import { useRecurringMutations, useRecurringRules, useUpcomingCashflow } from '../hooks';

const newRule = () => router.push('/recurring/new' as Href);

function Loading() {
  const styles = useStyles();
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={88} radius={16} />
      ))}
    </View>
  );
}

/** Planning → Upcoming: expected income and expenses over a horizon. */
export function UpcomingSection() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const isOnline = useSyncStore((s) => s.isOnline);
  const [horizon, setHorizon] = useState<CashflowHorizon>(14);
  const query = useUpcomingCashflow(horizon);
  const data = query.data;

  return (
    <View style={styles.list}>
      <ChoiceChips
        label={t('upcoming.horizon')}
        value={String(horizon)}
        onChange={(v) => setHorizon(Number(v) as CashflowHorizon)}
        choices={CASHFLOW_HORIZONS.map((h) => ({
          value: String(h),
          label: t(`upcoming.horizons.${h}`),
        }))}
      />
      <Text variant="bodySmall" tone="textSecondary">
        {t('upcoming.intro')}
      </Text>
      {!isOnline ? (
        <Text variant="caption" tone="textSecondary">
          {t('exchangeRates.outcome.offline')}
        </Text>
      ) : null}
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon="calendar-outline"
            title={t('upcoming.emptyTitle')}
            description={t('upcoming.emptyBody')}
            actionLabel={t('recurring.add')}
            onAction={newRule}
          />
        </Card>
      ) : (
        <>
          <Card>
            <View style={styles.group}>
              {data.combined ? (
                <>
                  {data.byCurrency.length > 1 ||
                  data.combined.currency !== data.byCurrency[0]?.currency ? (
                    <Text variant="label" tone="textSecondary">
                      {t('upcoming.combinedIn', { base: data.combined.currency })}
                    </Text>
                  ) : null}
                  <Totals
                    income={data.combined.incomeMinor}
                    expense={data.combined.expenseMinor}
                    net={data.combined.netMinor}
                    currency={data.combined.currency}
                  />
                </>
              ) : (
                <Text variant="bodySmall" tone="warning">
                  {t('upcoming.incomplete', { currencies: data.fx.missing.join(', ') })}
                </Text>
              )}
              {data.byCurrency.length > 1 || !data.combined ? (
                <>
                  <Divider />
                  <Text variant="label" tone="textSecondary">
                    {t('upcoming.byCurrency')}
                  </Text>
                  {data.byCurrency.map((f) => (
                    <View key={f.currency} style={styles.row}>
                      <Text variant="body" tone="textSecondary">
                        {f.currency}
                      </Text>
                      <MoneyText
                        value={{ amountMinor: f.netMinor, currency: f.currency }}
                        colorBySign
                        format={{ signDisplay: 'exceptZero' }}
                      />
                    </View>
                  ))}
                </>
              ) : null}
              <RateNote note={data.fx} showMissing={false} />
              {data.byCurrency.some((f) => f.approximate) ? (
                <Text variant="caption" tone="textSecondary">
                  {t('upcoming.approximate')}
                </Text>
              ) : null}
              {data.items.some((i) => i.state === 'overdue') ? (
                <Text variant="caption" tone="textSecondary">
                  {t('upcoming.includesOverdue')}
                </Text>
              ) : null}
            </View>
          </Card>
          <Card padding="none">
            {data.items.map((item, index) => (
              <View key={item.key}>
                {index > 0 ? <Divider inset={16} /> : null}
                <ExpectedRow item={item} formatterDate={formatter.date} />
              </View>
            ))}
          </Card>
        </>
      )}
      <Button
        label={t('upcoming.manageRecurring')}
        icon="repeat-outline"
        variant="ghost"
        size="md"
        onPress={() => router.setParams({ section: 'recurring' })}
      />
    </View>
  );
}

function Totals(p: {
  income: number;
  expense: number;
  net: number;
  currency: ExpectedItem['currency'];
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <>
      <View style={styles.row}>
        <Text variant="body" tone="textSecondary">
          {t('upcoming.income')}
        </Text>
        <MoneyText value={{ amountMinor: p.income, currency: p.currency }} />
      </View>
      <View style={styles.row}>
        <Text variant="body" tone="textSecondary">
          {t('upcoming.expenses')}
        </Text>
        <MoneyText value={{ amountMinor: p.expense, currency: p.currency }} />
      </View>
      <Divider />
      <View style={styles.row}>
        <Text variant="bodyStrong">{t('upcoming.net')}</Text>
        <MoneyText
          value={{ amountMinor: p.net, currency: p.currency }}
          colorBySign
          format={{ signDisplay: 'exceptZero' }}
          variant="bodyStrong"
        />
      </View>
    </>
  );
}

function ExpectedRow({
  item,
  formatterDate,
}: {
  item: ExpectedItem;
  formatterDate: (d: string, style?: 'numeric' | 'medium' | 'long') => string;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const theme = useTheme();
  const formatter = useFormatter();
  const { post, skip } = useRecurringMutations();
  const name =
    item.name ||
    (item.type === 'income' ? t('recurring.fallbackIncome') : t('recurring.fallbackExpense'));
  const kind =
    item.source === 'recurring'
      ? t('upcoming.sources.recurring')
      : item.isSubscription
        ? t('upcoming.sources.subscription')
        : t('upcoming.sources.bill');
  const date =
    item.state === 'due_today' ? t('upcoming.dueToday') : formatterDate(item.date, 'medium');
  const signed = item.type === 'income' ? item.amountMinor : -item.amountMinor;
  const amount = formatter.money(
    { amountMinor: signed, currency: item.currency },
    { signDisplay: 'exceptZero' },
  );
  const canAct = item.source === 'recurring' && item.state !== 'upcoming';
  const open = () =>
    router.push(
      (item.source === 'bill' ? `/bills/${item.sourceId}` : `/recurring/${item.sourceId}`) as Href,
    );

  return (
    <View style={styles.item}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('upcoming.a11yItem', { name, kind, date, amount })}
        onPress={open}
        style={({ pressed }) => [
          styles.itemMain,
          pressed && { backgroundColor: theme.colors.surfaceMuted },
        ]}
      >
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.meta}>
            {item.state === 'overdue' ? (
              <Badge label={t('upcoming.overdue')} tone="warning" />
            ) : null}
            <Text variant="bodySmall" tone="textSecondary" numberOfLines={2} style={styles.flex}>
              {[date, kind, item.accountName].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        <Text variant="amount" tone={item.type === 'income' ? 'positive' : 'text'}>
          {item.approximate ? `≈ ${amount}` : amount}
        </Text>
      </Pressable>
      {canAct ? (
        <View style={styles.actions}>
          <Button
            label={t('recurring.actions.add')}
            icon="checkmark"
            size="md"
            loading={post.isPending}
            onPress={() =>
              post.mutate(
                { id: item.sourceId, date: item.date },
                {
                  onSuccess: (r) =>
                    toastSaved(
                      t,
                      r.status === 'posted'
                        ? t('recurring.toast.posted')
                        : t('recurring.toast.already'),
                    ),
                },
              )
            }
          />
          <Button
            label={t('recurring.actions.skip')}
            variant="ghost"
            size="md"
            onPress={() =>
              confirmAction(t, {
                title: t('recurring.confirmSkip.title', {
                  date: formatterDate(item.date, 'medium'),
                }),
                body: t('recurring.confirmSkip.body'),
                confirmLabel: t('recurring.confirmSkip.confirm'),
                onConfirm: () =>
                  skip.mutate(
                    { id: item.sourceId, date: item.date },
                    { onSuccess: () => toastSaved(t, t('recurring.toast.skipped')) },
                  ),
              })
            }
          />
        </View>
      ) : null}
    </View>
  );
}

/** Planning → Recurring: the user's rules. */
export function RecurringSection() {
  const { t } = useTranslation();
  const styles = useStyles();
  const query = useRecurringRules('all');

  return (
    <View style={styles.list}>
      <View style={styles.toolbar}>
        <Text variant="heading" style={styles.flex}>
          {t('recurring.title')}
        </Text>
        <Button label={t('recurring.new')} icon="add" size="md" onPress={newRule} />
      </View>
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <Loading />
      ) : query.data.length === 0 ? (
        <Card>
          <EmptyState
            icon="repeat-outline"
            title={t('recurring.emptyTitle')}
            description={t('recurring.emptyBody')}
            actionLabel={t('recurring.add')}
            onAction={newRule}
          />
        </Card>
      ) : (
        query.data.map((item) => <RuleCard key={item.rule.id} item={item} />)
      )}
    </View>
  );
}

export function ruleScheduleLabel(
  t: TFunction,
  rule: { frequency: RecurringRuleItem['rule']['frequency']; interval: number },
) {
  const s = scheduleOf(rule);
  return s === 'custom'
    ? t('recurring.everyN', { count: rule.interval, unit: t(`recurring.units.${rule.frequency}`) })
    : t(`recurring.schedules.${s}`);
}

export function RuleCard({ item }: { item: RecurringRuleItem }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const { rule } = item;
  const name =
    rule.payee ||
    (rule.type === 'income' ? t('recurring.fallbackIncome') : t('recurring.fallbackExpense'));
  const status = item.finished ? 'finished' : rule.status;
  const signed = rule.type === 'income' ? rule.amountMinor : -rule.amountMinor;
  const next = item.next
    ? t('recurring.next', { date: formatter.date(item.next, 'medium') })
    : t('recurring.noMore');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${ruleScheduleLabel(t, rule)}, ${formatter.money({
        amountMinor: signed,
        currency: rule.currency,
      })}, ${t(`recurring.status.${status}`)}`}
      onPress={() => router.push(`/recurring/${rule.id}` as Href)}
    >
      <Card>
        <View style={styles.group}>
          <View style={styles.row}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
              {name}
            </Text>
            <MoneyText
              value={{ amountMinor: signed, currency: rule.currency }}
              colorBySign
              format={{ signDisplay: 'exceptZero' }}
            />
          </View>
          <Text variant="bodySmall" tone="textSecondary">
            {[ruleScheduleLabel(t, rule), item.accountName, rule.status === 'active' ? next : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={styles.meta}>
            <Badge
              label={t(`recurring.status.${status}`)}
              tone={status === 'active' ? 'positive' : 'neutral'}
            />
            {item.due.length > 0 ? (
              <Badge label={t('recurring.due', { count: item.due.length })} tone="warning" />
            ) : null}
          </View>
          {item.problem ? (
            <View style={styles.meta}>
              <Icon name="alert-circle-outline" size={16} tone="warning" />
              <Text variant="caption" tone="warning" style={styles.flex}>
                {t(`recurring.problem.${item.problem}`)}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  list: { gap: t.spacing.md },
  group: { gap: t.spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  flex: { flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs, flexWrap: 'wrap' },
  item: { paddingVertical: t.spacing.xs },
  itemMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    minHeight: 48,
  },
  actions: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    paddingBottom: t.spacing.sm,
  },
}));
