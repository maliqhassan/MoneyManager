import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card, Divider, Icon, Text } from '@/components/ui';
import type { CurrencyCode } from '@/domain/currency/currencies';
import type { PeriodicCost } from '@/domain/planning/recurrence';
import { useFormatter } from '@/i18n/FormatContext';
import type { SubscriptionSummary } from '@/repositories/types';
import { makeStyles } from '@/theme';
import { RateNote } from '@/features/exchangeRates/components/RateNote';

/**
 * Monthly and yearly subscription cost. Exact where the schedule allows;
 * approximate figures are marked "≈" and explained, never presented as exact.
 */
export function SubscriptionSummaryCard({ summary }: { summary: SubscriptionSummary }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const show = (cost: PeriodicCost, currency: CurrencyCode) =>
    `${cost.approximate ? '≈ ' : ''}${formatter.money({ amountMinor: cost.amountMinor, currency })}`;
  const rows = summary.base
    ? [
        {
          currency: summary.base.currency,
          monthly: summary.base.monthly,
          yearly: summary.base.yearly,
        },
      ]
    : summary.perCurrency;
  const approximate = rows.some((r) => r.monthly.approximate || r.yearly.approximate);

  return (
    <Card>
      <View style={styles.body}>
        <View>
          <Text variant="heading">{t('bills.summary.title')}</Text>
          <Text variant="bodySmall" tone="textSecondary">
            {t('bills.summary.count', { count: summary.count })}
          </Text>
        </View>
        {rows.map((r, index) => (
          <View key={r.currency} style={styles.block}>
            {index > 0 ? <Divider /> : null}
            <View style={styles.row}>
              <Text variant="body" tone="textSecondary">
                {t('bills.summary.monthly')}
              </Text>
              <Text variant="amount">{show(r.monthly, r.currency)}</Text>
            </View>
            <View style={styles.row}>
              <Text variant="body" tone="textSecondary">
                {t('bills.summary.yearly')}
              </Text>
              <Text variant="amount">{show(r.yearly, r.currency)}</Text>
            </View>
          </View>
        ))}
        {summary.missingRates.length > 0 ? (
          <View style={styles.notice}>
            <Icon name="information-circle-outline" size={16} tone="warning" />
            <Text variant="caption" tone="textSecondary" style={styles.flex}>
              {t('planning.incompleteRates', { currencies: summary.missingRates.join(', ') })}
            </Text>
          </View>
        ) : null}
        {approximate ? (
          <Text variant="caption" tone="textSecondary">
            {t('bills.summary.approximate')}
          </Text>
        ) : null}
        <RateNote note={summary.fx} policy={t('exchangeRates.note.estimate')} showMissing={false} />
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  body: { gap: t.spacing.sm },
  block: { gap: t.spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notice: { flexDirection: 'row', gap: t.spacing.xs, alignItems: 'flex-start' },
  flex: { flex: 1 },
}));
