import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card, Divider, Icon, MoneyText, Text } from '@/components/ui';
import type { CurrencyCode } from '@/domain/currency/currencies';
import { type CashFlowSummary, savingsRateBasisPoints } from '@/domain/finance/cashflow';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles } from '@/theme';

/** Income, spending (net of refunds; transfers excluded) and net for the period. */
export function CashFlowCard({
  period,
  summary,
  missingRates,
}: {
  period: { start: string; end: string };
  summary: CashFlowSummary | null;
  missingRates: readonly CurrencyCode[];
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();

  return (
    <Card>
      <View style={styles.body}>
        <View style={styles.header}>
          <Text variant="heading">{t('home.thisPeriod')}</Text>
          <Text variant="bodySmall" tone="textSecondary">
            {t('home.periodRange', {
              from: formatter.date(period.start, 'medium'),
              to: formatter.date(period.end, 'medium'),
            })}
          </Text>
        </View>
        {summary ? (
          <>
            <View style={styles.row}>
              <Text variant="body" tone="textSecondary">
                {t('home.income')}
              </Text>
              <MoneyText value={summary.income} colorBySign />
            </View>
            <View style={styles.row}>
              <Text variant="body" tone="textSecondary">
                {t('home.expenses')}
              </Text>
              <MoneyText value={summary.expenses} />
            </View>
            <Divider />
            <View style={styles.row}>
              <Text variant="bodyStrong">{t('home.net')}</Text>
              <MoneyText
                value={summary.net}
                colorBySign
                format={{ signDisplay: 'exceptZero' }}
                variant="bodyStrong"
              />
            </View>
            <View style={styles.row}>
              <Text variant="bodySmall" tone="textSecondary">
                {t('home.savingsRate')}
              </Text>
              <Text variant="bodySmall" tone="textSecondary">
                {(() => {
                  const rate = savingsRateBasisPoints(summary);
                  return rate === null ? t('home.savingsRateNone') : formatter.percent(rate, 0);
                })()}
              </Text>
            </View>
            <Text variant="caption" tone="textMuted">
              {t('planning.metricNote')}
            </Text>
          </>
        ) : (
          <View style={styles.notice}>
            <Icon name="information-circle-outline" size={18} tone="warning" />
            <Text variant="bodySmall" tone="textSecondary" style={styles.flex}>
              {t('home.flowIncomplete', { currencies: missingRates.join(', ') })}
            </Text>
          </View>
        )}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  body: { gap: t.spacing.sm },
  header: { gap: t.spacing.xxs, marginBottom: t.spacing.xs },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 32,
  },
  notice: { flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
}));
