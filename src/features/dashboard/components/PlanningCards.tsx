import { type Href, router } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Card, Divider, ErrorState, SectionHeader, Skeleton, Text } from '@/components/ui';
import { BillRow } from '@/features/bills/components/BillRow';
import { useUpcomingBills } from '@/features/bills/hooks';
import { BudgetCard } from '@/features/budgets/components/BudgetCard';
import { useBudgetOverviews } from '@/features/budgets/hooks';
import { GoalCard } from '@/features/goals/components/GoalCard';
import { useGoals } from '@/features/goals/hooks';
import type { BillListItem, BudgetListItem, GoalListItem } from '@/repositories/types';
import { makeStyles } from '@/theme';

const HOME_BUDGETS = 3;
const HOME_BILLS = 5;
const UPCOMING_DAYS = 14;
const HOME_GOALS = 2;

function EmptyLine({
  text,
  action,
  onAction,
}: {
  text: string;
  action: string;
  onAction: () => void;
}) {
  const styles = useStyles();
  return (
    <Card>
      <View style={styles.empty}>
        <Text variant="body" tone="textSecondary" style={styles.flex}>
          {text}
        </Text>
        <Button label={action} variant="ghost" size="md" onPress={onAction} />
      </View>
    </Card>
  );
}

/** Budgets closest to their limit first. */
export function HomeBudgets() {
  const { t } = useTranslation();
  const styles = useStyles();
  const query = useBudgetOverviews(false);
  const open = useCallback(
    (item: BudgetListItem) => router.push(`/budgets/${item.budget.id}` as Href),
    [],
  );
  const items = [...(query.data ?? [])]
    .sort((a, b) => b.evaluation.current.usedBasisPoints - a.evaluation.current.usedBasisPoints)
    .slice(0, HOME_BUDGETS);

  return (
    <View style={styles.section}>
      <SectionHeader
        title={t('home.budgetsTitle')}
        actionLabel={items.length > 0 ? t('common.seeAll') : undefined}
        onAction={
          items.length > 0 ? () => router.navigate('/budgets?section=budgets' as Href) : undefined
        }
      />
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <Skeleton height={120} radius={16} />
      ) : items.length === 0 ? (
        <EmptyLine
          text={t('home.noBudgets')}
          action={t('home.createBudget')}
          onAction={() => router.push('/budgets/new' as Href)}
        />
      ) : (
        items.map((item) => <BudgetCard key={item.budget.id} item={item} onPress={open} />)
      )}
    </View>
  );
}

/** Unpaid bills and subscriptions due in the next two weeks (overdue first). */
export function HomeUpcomingBills() {
  const { t } = useTranslation();
  const styles = useStyles();
  const query = useUpcomingBills(UPCOMING_DAYS, { limit: HOME_BILLS });
  const open = useCallback(
    (item: BillListItem) => router.push(`/bills/${item.bill.id}` as Href),
    [],
  );

  return (
    <View style={styles.section}>
      <SectionHeader
        title={t('home.upcomingTitle')}
        actionLabel={t('common.seeAll')}
        onAction={() => router.navigate('/budgets?section=bills' as Href)}
      />
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <Skeleton height={80} radius={16} />
      ) : query.data.length === 0 ? (
        <EmptyLine
          text={t('home.noUpcoming')}
          action={t('home.addBill')}
          onAction={() => router.push('/bills/new' as Href)}
        />
      ) : (
        <Card padding="none">
          {query.data.map((item, index) => (
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

export function HomeGoals() {
  const { t } = useTranslation();
  const styles = useStyles();
  const query = useGoals('active');
  const open = useCallback(
    (item: GoalListItem) => router.push(`/goals/${item.goal.id}` as Href),
    [],
  );
  const items = (query.data ?? []).slice(0, HOME_GOALS);

  return (
    <View style={styles.section}>
      <SectionHeader
        title={t('home.goalsTitle')}
        actionLabel={items.length > 0 ? t('common.seeAll') : undefined}
        onAction={
          items.length > 0 ? () => router.navigate('/budgets?section=goals' as Href) : undefined
        }
      />
      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <Skeleton height={120} radius={16} />
      ) : items.length === 0 ? (
        <EmptyLine
          text={t('home.noGoals')}
          action={t('home.createGoal')}
          onAction={() => router.push('/goals/new' as Href)}
        />
      ) : (
        items.map((item) => <GoalCard key={item.goal.id} item={item} onPress={open} />)
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  section: { gap: t.spacing.sm },
  empty: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 160 },
}));
