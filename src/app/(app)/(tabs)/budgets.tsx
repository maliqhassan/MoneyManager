import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  Button,
  Card,
  ChoiceChips,
  Divider,
  EmptyState,
  ErrorState,
  Screen,
  Skeleton,
  Text,
} from '@/components/ui';
import { dueInfo } from '@/domain/planning/bills';
import { BillRow } from '@/features/bills/components/BillRow';
import { SubscriptionSummaryCard } from '@/features/bills/components/SubscriptionSummaryCard';
import { useBills, useRecentPayments, useSubscriptionSummary } from '@/features/bills/hooks';
import { BudgetCard } from '@/features/budgets/components/BudgetCard';
import { useBudgetOverviews } from '@/features/budgets/hooks';
import { GoalCard } from '@/features/goals/components/GoalCard';
import { useGoals } from '@/features/goals/hooks';
import {
  RecurringSection,
  UpcomingSection,
} from '@/features/recurring/components/PlanningSections';
import { useFormatter } from '@/i18n/FormatContext';
import type { BillListItem, BudgetListItem, GoalFilter, GoalListItem } from '@/repositories/types';
import { makeStyles } from '@/theme';

type Section = 'budgets' | 'bills' | 'subscriptions' | 'goals' | 'upcoming' | 'recurring';
const SECTIONS: readonly Section[] = [
  'upcoming',
  'budgets',
  'bills',
  'subscriptions',
  'recurring',
  'goals',
];

/**
 * The planning area: budgets, bills, subscriptions and savings goals behind
 * one tab (the bottom navigation stays simple). Everything shown is computed
 * from the user's own data; empty sections say so and offer to create one.
 */
export default function PlanningScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const params = useLocalSearchParams<{ section?: string }>();
  const section: Section = (SECTIONS as readonly string[]).includes(params.section ?? '')
    ? (params.section as Section)
    : 'budgets';

  return (
    <Screen edges={[]}>
      <View accessibilityLabel={t('planning.a11ySections')}>
        <ChoiceChips
          value={section}
          onChange={(next) => router.setParams({ section: next })}
          choices={SECTIONS.map((value) => ({ value, label: t(`planning.sections.${value}`) }))}
        />
      </View>
      <View style={styles.content}>
        {section === 'budgets' ? <BudgetsSection /> : null}
        {section === 'bills' ? <BillsSection kind="bill" /> : null}
        {section === 'subscriptions' ? <BillsSection kind="subscription" /> : null}
        {section === 'goals' ? <GoalsSection /> : null}
        {section === 'upcoming' ? <UpcomingSection /> : null}
        {section === 'recurring' ? <RecurringSection /> : null}
      </View>
    </Screen>
  );
}

function ListSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={120} radius={16} />
      ))}
    </View>
  );
}

function BudgetsSection() {
  const { t } = useTranslation();
  const styles = useStyles();
  const [archived, setArchived] = useState(false);
  const query = useBudgetOverviews(archived);
  const open = useCallback(
    (item: BudgetListItem) => router.push(`/budgets/${item.budget.id}` as Href),
    [],
  );
  const create = () => router.push('/budgets/new' as Href);

  return (
    <View style={styles.list}>
      <View style={styles.toolbar}>
        <View style={styles.flex}>
          <ChoiceChips
            value={archived ? 'archived' : 'active'}
            onChange={(v) => setArchived(v === 'archived')}
            choices={[
              { value: 'active', label: t('budgets.filters.active') },
              { value: 'archived', label: t('budgets.filters.archived') },
            ]}
          />
        </View>
        <Button label={t('budgets.new')} icon="add" size="md" onPress={create} />
      </View>
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <ListSkeleton />
      ) : query.data.length === 0 ? (
        archived ? (
          <Text variant="body" tone="textSecondary">
            {t('budgets.archivedEmpty')}
          </Text>
        ) : (
          <Card>
            <EmptyState
              icon="pie-chart-outline"
              title={t('budgets.emptyTitle')}
              description={t('budgets.emptyBody')}
              actionLabel={t('budgets.create')}
              onAction={create}
            />
          </Card>
        )
      ) : (
        <>
          {query.data.map((item) => (
            <BudgetCard key={item.budget.id} item={item} onPress={open} />
          ))}
          <Text variant="caption" tone="textSecondary">
            {t('planning.metricNote')}
          </Text>
        </>
      )}
    </View>
  );
}

type BillFilter = 'unpaid' | 'overdue' | 'paid' | 'archived';

function BillsSection({ kind }: { kind: 'bill' | 'subscription' }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const today = formatter.today();
  const [filter, setFilter] = useState<BillFilter>('unpaid');
  const list = useBills({ kind, archived: filter === 'archived' });
  const paid = useRecentPayments(kind, 50);
  const summary = useSubscriptionSummary();
  const subscription = kind === 'subscription';
  const open = useCallback(
    (item: BillListItem) => router.push(`/bills/${item.bill.id}` as Href),
    [],
  );
  const create = () => router.push(`/bills/new?kind=${kind}` as Href);

  const items =
    filter === 'overdue'
      ? (list.data ?? []).filter((i) => dueInfo(i.bill.nextDueDate, today).status === 'overdue')
      : (list.data ?? []);
  const filters: BillFilter[] = subscription
    ? ['unpaid', 'paid', 'archived']
    : ['unpaid', 'overdue', 'paid', 'archived'];

  return (
    <View style={styles.list}>
      {subscription && summary.data && summary.data.count > 0 ? (
        <SubscriptionSummaryCard summary={summary.data} />
      ) : null}
      <View style={styles.toolbar}>
        <View style={styles.flex}>
          <ChoiceChips
            value={filter}
            onChange={setFilter}
            choices={filters.map((value) => ({
              value,
              label:
                subscription && value === 'unpaid'
                  ? t('bills.filters.active')
                  : t(`bills.filters.${value}`),
            }))}
          />
        </View>
        <Button
          label={subscription ? t('bills.newSubscription') : t('bills.newBill')}
          icon="add"
          size="md"
          onPress={create}
        />
      </View>

      {filter === 'paid' ? (
        paid.error ? (
          <ErrorState error={paid.error} onRetry={() => void paid.refetch()} />
        ) : !paid.data ? (
          <ListSkeleton />
        ) : paid.data.length === 0 ? (
          <Text variant="body" tone="textSecondary">
            {t('bills.noPaid')}
          </Text>
        ) : (
          <Card padding="none">
            {paid.data.map((p, index) => (
              <View key={p.payment.id}>
                {index > 0 ? <Divider inset={16} /> : null}
                <View style={styles.paidRow}>
                  <View style={styles.flex}>
                    <Text variant="bodyStrong">{p.billName}</Text>
                    <Text variant="bodySmall" tone="textSecondary">
                      {t('bills.due.on', { date: formatter.date(p.payment.dueDate, 'medium') })}
                      {p.payment.transaction
                        ? ` · ${t('bills.due.paidOn', { date: formatter.date(p.payment.transaction.localDate, 'medium') })}`
                        : ''}
                    </Text>
                  </View>
                  <Text variant="amount">
                    {p.payment.transaction
                      ? formatter.money({
                          amountMinor: Math.abs(p.payment.transaction.amountMinor),
                          currency: p.payment.transaction.currency,
                        })
                      : t('bills.detail.transactionMissing')}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        filter === 'unpaid' ? (
          <Card>
            <EmptyState
              icon={subscription ? 'repeat-outline' : 'receipt-outline'}
              title={subscription ? t('bills.subscriptionsEmptyTitle') : t('bills.emptyTitle')}
              description={subscription ? t('bills.subscriptionsEmptyBody') : t('bills.emptyBody')}
              actionLabel={subscription ? t('bills.newSubscription') : t('bills.newBill')}
              onAction={create}
            />
          </Card>
        ) : (
          <Text variant="body" tone="textSecondary">
            {filter === 'overdue' ? t('bills.noOverdue') : t('bills.archivedEmpty')}
          </Text>
        )
      ) : (
        <Card padding="none">
          {items.map((item, index) => (
            <View key={item.bill.id}>
              {index > 0 ? <Divider inset={72} /> : null}
              <BillRow item={item} onPress={open} />
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

function GoalsSection() {
  const { t } = useTranslation();
  const styles = useStyles();
  const [filter, setFilter] = useState<GoalFilter>('active');
  const query = useGoals(filter);
  const open = useCallback(
    (item: GoalListItem) => router.push(`/goals/${item.goal.id}` as Href),
    [],
  );
  const create = () => router.push('/goals/new' as Href);

  return (
    <View style={styles.list}>
      <View style={styles.toolbar}>
        <View style={styles.flex}>
          <ChoiceChips
            value={filter}
            onChange={setFilter}
            choices={(['active', 'completed', 'archived'] as const).map((value) => ({
              value,
              label: t(`goals.filters.${value}`),
            }))}
          />
        </View>
        <Button label={t('goals.new')} icon="add" size="md" onPress={create} />
      </View>
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <ListSkeleton />
      ) : query.data.length === 0 ? (
        filter === 'active' ? (
          <Card>
            <EmptyState
              icon="flag-outline"
              title={t('goals.emptyTitle')}
              description={t('goals.emptyBody')}
              actionLabel={t('goals.new')}
              onAction={create}
            />
          </Card>
        ) : (
          <Text variant="body" tone="textSecondary">
            {filter === 'completed' ? t('goals.completedEmpty') : t('goals.archivedEmpty')}
          </Text>
        )
      ) : (
        query.data.map((item) => <GoalCard key={item.goal.id} item={item} onPress={open} />)
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  content: { gap: t.spacing.lg },
  list: { gap: t.spacing.md },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    flexWrap: 'wrap',
  },
  flex: { flex: 1 },
  paidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    padding: t.spacing.lg,
    minHeight: t.minTouchTarget,
  },
}));
