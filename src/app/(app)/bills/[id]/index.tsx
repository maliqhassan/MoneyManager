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
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { monthlyCost, presetOf, yearlyCost } from '@/domain/planning/recurrence';
import { useDueLabel } from '@/features/bills/components/BillRow';
import { useBill, useBillMutations } from '@/features/bills/hooks';
import { useCategoryName } from '@/features/categories/hooks';
import { confirmAction, toastSaved } from '@/features/planning/feedback';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles, useTheme } from '@/theme';

export default function BillDetailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const dueLabel = useDueLabel();
  const categoryName = useCategoryName();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const query = useBill(id);
  const mutations = useBillMutations();

  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading) return <LoadingState />;
  const item = query.data;
  if (!item) return <EmptyState icon="alert-circle-outline" title={t('states.notFound')} />;

  const { bill } = item;
  const fmt = (amountMinor: number) => formatter.money({ amountMinor, currency: bill.currency });
  const preset = presetOf(bill);
  const schedule =
    preset === 'custom'
      ? t(`bills.customEvery.${bill.frequency}`, { count: bill.interval })
      : t(`bills.presets.${preset}`);
  const due = dueLabel(bill.nextDueDate);
  const monthly = monthlyCost(bill.amountMinor, bill);
  const yearly = yearlyCost(bill.amountMinor, bill);
  const approx = (approximate: boolean) => (approximate ? '≈ ' : '');
  const reminder =
    bill.reminderDaysBefore === null
      ? t('bills.reminders.none')
      : bill.reminderDaysBefore === 0
        ? t('bills.reminders.sameDay')
        : t('bills.reminders.daysBefore', { count: bill.reminderDaysBefore });
  const ended =
    !bill.isActive && bill.endDate !== null && item.payments[0]?.dueDate === bill.nextDueDate;

  const skip = () =>
    confirmAction(t, {
      title: t('bills.confirmSkip.title'),
      body: t('bills.confirmSkip.body'),
      confirmLabel: t('bills.actions.skip'),
      onConfirm: () =>
        mutations.skip.mutate(
          { id, dueDate: bill.nextDueDate },
          { onSuccess: () => toastSaved(t, t('bills.toast.skipped')) },
        ),
    });
  const archive = () =>
    confirmAction(t, {
      title: t('bills.confirmArchive.title'),
      body: t('bills.confirmArchive.body'),
      confirmLabel: t('bills.actions.archive'),
      onConfirm: () =>
        mutations.setArchived.mutate(
          { id, archived: true },
          { onSuccess: () => toastSaved(t, t('bills.toast.archived')) },
        ),
    });
  const undo = (paymentId: string) =>
    confirmAction(t, {
      title: t('bills.confirmUndo.title'),
      body: t('bills.confirmUndo.body'),
      confirmLabel: t('bills.actions.undo'),
      destructive: true,
      onConfirm: () =>
        mutations.undoPayment.mutate(paymentId, {
          onSuccess: () => toastSaved(t, t('bills.toast.undone')),
        }),
    });
  const mutationError =
    mutations.skip.error ?? mutations.setArchived.error ?? mutations.undoPayment.error;

  return (
    <Screen>
      <Stack.Screen options={{ title: bill.name }} />
      <Card>
        <View style={styles.body}>
          <View style={styles.header}>
            <View style={styles.flex}>
              <Text variant="heading">{bill.name}</Text>
              <Text
                variant="body"
                tone={bill.isActive && due.status === 'overdue' ? 'negative' : 'textSecondary'}
              >
                {ended
                  ? t('bills.detail.ended')
                  : bill.isActive
                    ? `${due.text} · ${formatter.date(bill.nextDueDate, 'medium')}`
                    : t('bills.archivedBadge')}
              </Text>
            </View>
            {bill.isActive ? (
              <Badge
                label={t(`bills.status.${due.status}`)}
                tone={
                  due.status === 'overdue'
                    ? 'negative'
                    : due.status === 'due_today'
                      ? 'warning'
                      : 'neutral'
                }
              />
            ) : null}
          </View>
          <Text variant="amountLarge">
            {bill.isVariableAmount ? `≈ ${fmt(bill.amountMinor)}` : fmt(bill.amountMinor)}
          </Text>
          <Divider />
          <Row label={t('bills.detail.schedule')} value={schedule} />
          <Row
            label={t('bills.summary.monthly')}
            value={`${approx(monthly.approximate)}${fmt(monthly.amountMinor)}`}
          />
          <Row
            label={t('bills.summary.yearly')}
            value={`${approx(yearly.approximate)}${fmt(yearly.amountMinor)}`}
          />
          {bill.endDate ? (
            <Row label={t('bills.fields.endDate')} value={formatter.date(bill.endDate, 'medium')} />
          ) : null}
          <Row
            label={t('bills.detail.account')}
            value={item.accountName ?? t('bills.fields.noAccount')}
          />
          <Row
            label={t('bills.detail.category')}
            value={
              item.categoryName
                ? categoryName({ name: item.categoryName, systemKey: item.categorySystemKey })
                : '—'
            }
          />
          <Row label={t('bills.detail.reminder')} value={reminder} />
          {bill.autopay ? <Badge label={t('bills.autopayBadge')} /> : null}
          {bill.notes ? (
            <Text variant="bodySmall" tone="textSecondary">
              {bill.notes}
            </Text>
          ) : null}
        </View>
      </Card>

      <View style={styles.notice}>
        <Icon name="information-circle-outline" size={18} tone="textSecondary" />
        <Text variant="bodySmall" tone="textSecondary" style={styles.flex}>
          {t('bills.detail.notATransaction')}
        </Text>
      </View>

      {bill.isActive ? (
        <View style={styles.actions}>
          <Button
            label={t('bills.actions.markPaid')}
            icon="checkmark-circle-outline"
            onPress={() => router.push(`/bills/${id}/pay` as Href)}
          />
          <Button
            label={t('bills.actions.skip')}
            icon="play-skip-forward-outline"
            variant="secondary"
            loading={mutations.skip.isPending}
            onPress={skip}
          />
        </View>
      ) : null}
      {mutationError ? <ErrorState error={mutationError} /> : null}

      <SectionHeader title={t('bills.detail.history')} />
      {item.payments.length === 0 ? (
        <Text variant="body" tone="textSecondary">
          {t('bills.detail.historyEmpty')}
        </Text>
      ) : (
        <Card padding="none">
          {item.payments.map((p, index) => (
            <View key={p.id}>
              {index > 0 ? <Divider inset={16} /> : null}
              <View style={styles.paymentRow}>
                <Pressable
                  accessibilityRole={p.transaction ? 'button' : 'text'}
                  disabled={!p.transaction}
                  onPress={() =>
                    p.transaction && router.push(`/transactions/${p.transaction.id}` as Href)
                  }
                  style={({ pressed }) => [
                    styles.paymentMain,
                    pressed && { backgroundColor: theme.colors.surfaceMuted },
                  ]}
                >
                  <Text variant="body">
                    {t('bills.due.on', { date: formatter.date(p.dueDate, 'medium') })}
                  </Text>
                  <Text variant="bodySmall" tone="textSecondary">
                    {p.status === 'skipped'
                      ? t('bills.due.skipped')
                      : p.transaction
                        ? `${t('bills.due.paidOn', { date: formatter.date(p.transaction.localDate, 'medium') })} · ${p.transaction.accountName} · ${formatter.money({ amountMinor: Math.abs(p.transaction.amountMinor), currency: p.transaction.currency })}`
                        : t('bills.detail.transactionMissing')}
                  </Text>
                </Pressable>
                <Button
                  label={t('bills.actions.undo')}
                  variant="ghost"
                  size="md"
                  onPress={() => undo(p.id)}
                />
              </View>
            </View>
          ))}
        </Card>
      )}

      <View style={styles.actions}>
        <Button
          label={t('bills.actions.edit')}
          icon="create-outline"
          variant="secondary"
          onPress={() => router.push(`/bills/${id}/edit` as Href)}
        />
        {bill.isActive ? (
          <Button
            label={t('bills.actions.archive')}
            icon="archive-outline"
            variant="ghost"
            onPress={archive}
          />
        ) : (
          <Button
            label={t('bills.actions.restore')}
            icon="arrow-undo-outline"
            variant="secondary"
            onPress={() =>
              mutations.setArchived.mutate(
                { id, archived: false },
                { onSuccess: () => toastSaved(t, t('bills.toast.restored')) },
              )
            }
          />
        )}
      </View>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text variant="body" tone="textSecondary" style={styles.flex}>
        {label}
      </Text>
      <Text variant="body" style={styles.value}>
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
  value: { flexShrink: 1, textAlign: 'right' },
  notice: { flexDirection: 'row', gap: t.spacing.xs, alignItems: 'flex-start' },
  actions: { gap: t.spacing.sm },
  paymentRow: { flexDirection: 'row', alignItems: 'center', paddingEnd: t.spacing.sm },
  paymentMain: {
    flex: 1,
    gap: 2,
    padding: t.spacing.lg,
    minHeight: t.minTouchTarget,
  },
}));
