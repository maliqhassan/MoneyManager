import { type Href, router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  Icon,
  ListItem,
  LoadingState,
  MoneyText,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { useCategoryName } from '@/features/categories/hooks';
import { confirmAction, toastSaved } from '@/features/planning/feedback';
import { ruleScheduleLabel } from '@/features/recurring/components/PlanningSections';
import { useRecurringMutations, useRecurringRule } from '@/features/recurring/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import { AppError } from '@/lib/errors';
import { makeStyles } from '@/theme';

/** One recurring rule: what is due, what comes next, and what was done. */
export default function RecurringDetailScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const categoryName = useCategoryName();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useRecurringRule(id);
  const m = useRecurringMutations();

  if (query.isLoading) return <LoadingState />;
  if (query.error || !query.data) {
    return (
      <Screen>
        <ErrorState
          error={query.error ?? new AppError('not_found', 'Recurring rule not found')}
          onRetry={() => void query.refetch()}
        />
      </Screen>
    );
  }
  const d = query.data;
  const { rule } = d;
  const name =
    rule.payee ||
    (rule.type === 'income' ? t('recurring.fallbackIncome') : t('recurring.fallbackExpense'));
  const status = d.finished ? 'finished' : rule.status;
  const signed = rule.type === 'income' ? rule.amountMinor : -rule.amountMinor;
  const date = (v: string) => formatter.date(v, 'medium');
  const ended = rule.status === 'ended';
  const fail = (e: unknown) => toastSaved(t, (e as AppError)?.message ?? String(e));
  const post = (when: string) =>
    m.post.mutate(
      { id, date: when },
      {
        onSuccess: (r) =>
          toastSaved(
            t,
            r.status === 'posted' ? t('recurring.toast.posted') : t('recurring.toast.already'),
          ),
      },
    );
  const skip = (when: string) =>
    confirmAction(t, {
      title: t('recurring.confirmSkip.title', { date: date(when) }),
      body: t('recurring.confirmSkip.body'),
      confirmLabel: t('recurring.confirmSkip.confirm'),
      onConfirm: () =>
        m.skip.mutate(
          { id, date: when },
          { onSuccess: () => toastSaved(t, t('recurring.toast.skipped')) },
        ),
    });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('recurring.detailTitle') }} />
      <Card>
        <View style={styles.group}>
          <View style={styles.row}>
            <Text variant="title" style={styles.flex} numberOfLines={2}>
              {name}
            </Text>
            <Badge
              label={t(`recurring.status.${status}`)}
              tone={status === 'active' ? 'positive' : 'neutral'}
            />
          </View>
          <MoneyText
            value={{ amountMinor: signed, currency: rule.currency }}
            colorBySign
            format={{ signDisplay: 'exceptZero' }}
            variant="amountLarge"
          />
          <Text variant="body" tone="textSecondary">
            {[
              ruleScheduleLabel(t, rule),
              d.accountName,
              d.categoryName
                ? categoryName({ name: d.categoryName, systemKey: d.categorySystemKey })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Text variant="bodySmall" tone="textSecondary">
            {t(`recurring.posting.${rule.autoPost ? 'auto' : 'confirm'}`)}
            {' · '}
            {rule.reminderDaysBefore === null
              ? t('recurring.reminderNone')
              : rule.reminderDaysBefore === 0
                ? t('recurring.reminderSameDay')
                : t('recurring.reminderDaysBefore', { count: rule.reminderDaysBefore })}
          </Text>
          {rule.status === 'active' ? (
            <Text variant="bodySmall" tone="textSecondary">
              {d.next ? t('recurring.next', { date: date(d.next) }) : t('recurring.noMore')}
            </Text>
          ) : null}
          {d.problem ? (
            <View style={styles.notice}>
              <Icon name="alert-circle-outline" size={18} tone="warning" />
              <Text variant="bodySmall" tone="warning" style={styles.flex}>
                {t(`recurring.problem.${d.problem}`)}
              </Text>
            </View>
          ) : null}
          {rule.status === 'paused' ? (
            <Text variant="bodySmall" tone="textSecondary">
              {t('recurring.pausedNote')}
            </Text>
          ) : null}
        </View>
      </Card>

      {d.due.length > 0 ? (
        <>
          <SectionHeader title={t('recurring.waiting')} />
          <Card padding="none">
            {d.due.map((o, index) => (
              <View key={o.date}>
                {index > 0 ? <Divider inset={16} /> : null}
                <View style={styles.occurrence}>
                  <Text variant="bodyStrong" style={styles.flex}>
                    {date(o.date)}
                  </Text>
                  <Button
                    label={t('recurring.actions.add')}
                    icon="checkmark"
                    size="md"
                    disabled={d.problem !== null}
                    loading={m.post.isPending}
                    onPress={() => post(o.date)}
                  />
                  <Button
                    label={t('recurring.actions.skip')}
                    variant="ghost"
                    size="md"
                    onPress={() => skip(o.date)}
                  />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {d.upcoming.length > 0 ? (
        <>
          <SectionHeader title={t('recurring.upcoming')} />
          <Card padding="none">
            {d.upcoming.map((when, index) => (
              <View key={when}>
                {index > 0 ? <Divider inset={16} /> : null}
                <View style={styles.occurrence}>
                  <Text variant="body" style={styles.flex}>
                    {date(when)}
                  </Text>
                  <Button
                    label={t('recurring.actions.skip')}
                    variant="ghost"
                    size="md"
                    onPress={() => skip(when)}
                  />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader title={t('recurring.history')} />
      <Card padding="none">
        {d.history.length === 0 ? (
          <View style={styles.pad}>
            <Text variant="body" tone="textSecondary">
              {t('recurring.historyEmpty')}
            </Text>
          </View>
        ) : (
          d.history.map((h, index) => {
            const label = h.transactionDeleted
              ? t('recurring.historyStatus.deleted')
              : t(`recurring.historyStatus.${h.status}`);
            return (
              <View key={h.date}>
                {index > 0 ? <Divider inset={16} /> : null}
                {h.status === 'posted' && h.transactionId && !h.transactionDeleted ? (
                  <ListItem
                    title={date(h.date)}
                    subtitle={label}
                    trailing={
                      h.amountMinor !== null && h.currency ? (
                        <MoneyText
                          value={{ amountMinor: h.amountMinor, currency: h.currency }}
                          colorBySign
                        />
                      ) : undefined
                    }
                    onPress={() => router.push(`/transactions/${h.transactionId}` as Href)}
                  />
                ) : (
                  <View style={styles.occurrence}>
                    <View style={styles.flex}>
                      <Text variant="body">{date(h.date)}</Text>
                      <Text variant="bodySmall" tone="textSecondary">
                        {label}
                      </Text>
                    </View>
                    {h.status === 'skipped' && !ended ? (
                      <Button
                        label={t('recurring.actions.unskip')}
                        variant="ghost"
                        size="md"
                        onPress={() => m.unskip.mutate({ id, date: h.date })}
                      />
                    ) : null}
                    {h.transactionDeleted ? (
                      <Button
                        label={t('recurring.actions.postAgain')}
                        variant="ghost"
                        size="md"
                        onPress={() =>
                          confirmAction(t, {
                            title: t('recurring.confirmPostAgain.title'),
                            body: t('recurring.confirmPostAgain.body', { date: date(h.date) }),
                            confirmLabel: t('recurring.confirmPostAgain.confirm'),
                            onConfirm: () =>
                              m.postAgain.mutate(
                                { id, date: h.date },
                                {
                                  onSuccess: () => toastSaved(t, t('recurring.toast.posted')),
                                  onError: fail,
                                },
                              ),
                          })
                        }
                      />
                    ) : null}
                  </View>
                )}
              </View>
            );
          })
        )}
      </Card>

      {!ended ? (
        <View style={styles.actions}>
          <Button
            label={t('recurring.actions.edit')}
            icon="create-outline"
            variant="secondary"
            onPress={() => router.push(`/recurring/${id}/edit` as Href)}
          />
          {rule.status === 'active' ? (
            <Button
              label={t('recurring.actions.pause')}
              icon="pause-outline"
              variant="secondary"
              onPress={() =>
                m.pause.mutate(id, { onSuccess: () => toastSaved(t, t('recurring.toast.paused')) })
              }
            />
          ) : (
            <Button
              label={t('recurring.actions.resume')}
              icon="play-outline"
              variant="secondary"
              onPress={() =>
                m.resume.mutate(id, {
                  onSuccess: () => toastSaved(t, t('recurring.toast.resumed')),
                })
              }
            />
          )}
          <Button
            label={t('recurring.actions.end')}
            icon="stop-circle-outline"
            variant="ghost"
            onPress={() =>
              confirmAction(t, {
                title: t('recurring.confirmEnd.title'),
                body: t('recurring.confirmEnd.body'),
                confirmLabel: t('recurring.confirmEnd.confirm'),
                destructive: true,
                onConfirm: () =>
                  m.end.mutate(id, { onSuccess: () => toastSaved(t, t('recurring.toast.ended')) }),
              })
            }
          />
        </View>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  group: { gap: t.spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  flex: { flex: 1 },
  pad: { padding: t.spacing.lg },
  notice: { flexDirection: 'row', gap: t.spacing.xs, alignItems: 'flex-start' },
  occurrence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    minHeight: 56,
    flexWrap: 'wrap',
  },
  actions: { gap: t.spacing.sm },
}));
