import { type Href, router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

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
import { addMonths } from '@/domain/dates/calendar';
import { CategoryIcon } from '@/features/categories/components/CategoryIcon';
import { useGoal, useGoalMutations } from '@/features/goals/hooks';
import { confirmAction, toastSaved } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles, useTheme } from '@/theme';

/** Goal detail: progress, suggested monthly amount and contribution history. */
export default function GoalDetailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const query = useGoal(id);
  const { setArchived } = useGoalMutations();

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading) return <LoadingState />;
  const item = query.data;
  if (!item) return <EmptyState icon="alert-circle-outline" title={t('states.notFound')} />;

  const { goal, progress } = item;
  const archived = goal.status === 'archived';
  const fmt = (amountMinor: number) => formatter.money({ amountMinor, currency: goal.currency });
  const s = progress.suggestion;
  const suggestion =
    s.kind === 'monthly'
      ? s.months === 1
        ? t('goals.suggestion.monthly_one', {
            amount: fmt(s.amountMinor),
            date: formatter.date(goal.targetDate ?? addMonths(formatter.today(), 1), 'medium'),
          })
        : t('goals.suggestion.monthly', {
            amount: fmt(s.amountMinor),
            months: s.months,
            date: formatter.date(goal.targetDate ?? formatter.today(), 'medium'),
          })
      : t(`goals.suggestion.${s.kind}`);

  return (
    <Screen>
      <Stack.Screen options={{ title: goal.name }} />
      <Card>
        <View style={styles.body}>
          <View style={styles.header}>
            <CategoryIcon icon={goal.icon} color={goal.color} size={44} />
            <View style={styles.flex}>
              <Text variant="heading">{goal.name}</Text>
              <Text variant="bodySmall" tone="textSecondary">
                {goal.targetDate
                  ? t('goals.targetOn', { date: formatter.date(goal.targetDate, 'medium') })
                  : t('goals.noTargetDate')}
                {progress.daysRemaining !== null &&
                progress.daysRemaining >= 0 &&
                !progress.completed
                  ? ` · ${t('goals.daysLeft', { count: progress.daysRemaining })}`
                  : ''}
              </Text>
            </View>
            {progress.completed ? <Badge label={t('goals.completed')} tone="positive" /> : null}
            {archived ? <Badge label={t('goals.filters.archived')} /> : null}
          </View>
          <Text variant="amountLarge">{fmt(progress.savedMinor)}</Text>
          <Text variant="body" tone="textSecondary">
            {t('goals.savedOf', {
              saved: fmt(progress.savedMinor),
              target: fmt(progress.targetMinor),
            })}
          </Text>
          <ProgressBar
            valueBasisPoints={progress.progressBasisPoints}
            tone={progress.completed ? 'positive' : 'primary'}
            accessibilityLabel={t('goals.a11y.progress', { name: goal.name })}
            height={10}
          />
          <View style={styles.row}>
            <Text variant="bodySmall" tone="textSecondary">
              {formatter.percent(progress.progressBasisPoints, 0)}
            </Text>
            <Text variant="bodySmall" tone={progress.completed ? 'positive' : 'textSecondary'}>
              {progress.completed
                ? progress.overMinor > 0
                  ? t('goals.overTarget', { amount: fmt(progress.overMinor) })
                  : t('goals.completed')
                : t('goals.remaining', { amount: fmt(progress.remainingMinor) })}
            </Text>
          </View>
          <Divider />
          <Text variant="label" tone="textSecondary">
            {t('goals.detail.suggested')}
          </Text>
          <Text variant="body">{suggestion}</Text>
          {item.accountName ? (
            <Text variant="bodySmall" tone="textSecondary">
              {t('goals.detail.account', { name: item.accountName })}
            </Text>
          ) : null}
        </View>
      </Card>

      {item.missingRates.length > 0 ? (
        <View style={styles.notice}>
          <Icon name="information-circle-outline" size={18} tone="warning" />
          <Text variant="bodySmall" tone="textSecondary" style={styles.flex}>
            {t('planning.incompleteRates', { currencies: item.missingRates.join(', ') })}
          </Text>
        </View>
      ) : null}

      {!archived ? (
        <Button
          label={t('goals.contribution.add')}
          icon="add-circle-outline"
          onPress={() => router.push(`/goals/${id}/contribute` as Href)}
        />
      ) : null}

      <View style={styles.notice}>
        <Icon name="information-circle-outline" size={18} tone="textSecondary" />
        <Text variant="caption" tone="textSecondary" style={styles.flex}>
          {t('goals.model')}
        </Text>
      </View>

      <SectionHeader title={t('goals.detail.history')} />
      {item.contributions.length === 0 ? (
        <Text variant="body" tone="textSecondary">
          {t('goals.detail.historyEmpty')}
        </Text>
      ) : (
        <Card padding="none">
          {item.contributions.map((c, index) => {
            const amount = formatter.money({ amountMinor: c.amountMinor, currency: c.currency });
            const meta = [
              formatter.date(c.contributedOn, 'medium'),
              c.transfer
                ? t('goals.detail.transfer', {
                    from: c.transfer.fromAccountName,
                    to: c.transfer.toAccountName,
                  })
                : c.accountName,
              c.notes,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <View key={c.id}>
                {index > 0 ? <Divider inset={16} /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${amount}, ${meta}`}
                  disabled={archived}
                  onPress={() =>
                    router.push(`/goals/${id}/contribute?contributionId=${c.id}` as Href)
                  }
                  style={({ pressed }) => [
                    styles.contribution,
                    pressed && { backgroundColor: theme.colors.surfaceMuted },
                  ]}
                >
                  <View style={styles.flex}>
                    <Text variant="body" numberOfLines={2}>
                      {meta}
                    </Text>
                  </View>
                  <Text variant="amount" tone="positive">
                    {amount}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}

      <View style={styles.actions}>
        <Button
          label={t('goals.actions.edit')}
          icon="create-outline"
          variant="secondary"
          onPress={() => router.push(`/goals/${id}/edit` as Href)}
        />
        {archived ? (
          <Button
            label={t('goals.actions.restore')}
            icon="arrow-undo-outline"
            variant="secondary"
            onPress={() =>
              setArchived.mutate(
                { id, archived: false },
                { onSuccess: () => toastSaved(t, t('goals.toast.restored')) },
              )
            }
          />
        ) : (
          <Button
            label={t('goals.actions.archive')}
            icon="archive-outline"
            variant="ghost"
            onPress={() =>
              confirmAction(t, {
                title: t('goals.confirmArchive.title'),
                body: t('goals.confirmArchive.body'),
                confirmLabel: t('goals.actions.archive'),
                onConfirm: () =>
                  setArchived.mutate(
                    { id, archived: true },
                    { onSuccess: () => toastSaved(t, t('goals.toast.archived')) },
                  ),
              })
            }
          />
        )}
        {setArchived.error ? <ErrorState error={setArchived.error} /> : null}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  body: { gap: t.spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  flex: { flex: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  notice: { flexDirection: 'row', gap: t.spacing.xs, alignItems: 'flex-start' },
  contribution: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    padding: t.spacing.lg,
    minHeight: t.minTouchTarget,
  },
  actions: { gap: t.spacing.sm },
}));
