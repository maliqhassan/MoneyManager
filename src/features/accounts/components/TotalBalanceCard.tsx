import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card, Divider, Icon, MoneyText, Text } from '@/components/ui';
import type { CurrencyCode } from '@/domain/currency/currencies';
import type { ConversionNote } from '@/domain/fx/note';
import { RateNote } from '@/features/exchangeRates/components/RateNote';
import type { Money } from '@/domain/money/money';
import { makeStyles } from '@/theme';

export interface TotalBalanceCardProps {
  combinedTotal: Money | null;
  totals: readonly Money[];
  missingRates: readonly CurrencyCode[];
  accountCount: number;
  /** Rates behind the combined total (latest cached rates). */
  fx?: ConversionNote;
}

/**
 * Total balance. One currency (or all rates known) → a single total.
 * Mixed currencies without rates → per-currency totals and an explicit note;
 * never a guessed or partial sum.
 */
export function TotalBalanceCard({
  combinedTotal,
  totals,
  missingRates,
  accountCount,
  fx,
}: TotalBalanceCardProps) {
  const { t } = useTranslation();
  const styles = useStyles();

  return (
    <Card>
      <View style={styles.body}>
        <Text variant="label" tone="textSecondary">
          {t('home.totalBalance')}
        </Text>
        {combinedTotal ? (
          <MoneyText
            value={combinedTotal}
            variant="amountLarge"
            adjustsFontSizeToFit
            numberOfLines={1}
          />
        ) : (
          <>
            <Text variant="title" tone="textSecondary">
              {t('balance.totalIncomplete')}
            </Text>
            <View style={styles.notice} accessibilityRole="text">
              <Icon name="information-circle-outline" size={18} tone="warning" />
              <Text variant="bodySmall" tone="textSecondary" style={styles.noticeText}>
                {t('balance.incompleteBody', { currencies: missingRates.join(', ') })}
              </Text>
            </View>
          </>
        )}
        {totals.length > 1 ? (
          <>
            <Divider />
            <Text variant="label" tone="textSecondary">
              {t('balance.byCurrency')}
            </Text>
            {totals.map((total) => (
              <View key={total.currency} style={styles.currencyRow}>
                <Text variant="body" tone="textSecondary">
                  {total.currency}
                </Text>
                <MoneyText value={total} />
              </View>
            ))}
          </>
        ) : null}
        {fx ? (
          <RateNote note={fx} policy={t('exchangeRates.note.estimate')} showMissing={false} />
        ) : null}
        <Text variant="bodySmall" tone="textSecondary">
          {t('home.accountsCount', { count: accountCount })}
        </Text>
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  body: { gap: t.spacing.sm },
  notice: { flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' },
  noticeText: { flex: 1 },
  currencyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 32,
  },
}));
