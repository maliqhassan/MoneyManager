import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Icon, MoneyText, Text } from '@/components/ui';
import type { Money } from '@/domain/money/money';
import type { DailySpending } from '@/domain/reports/aggregate';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles, useTheme } from '@/theme';

const SIZE = 280;
const INNER = 148;
const BAR_WIDTH = 6;
const BAR_MIN = 6;
const BAR_MAX = 46;
/** Distance from the centre to the inner end of each bar. */
const BAR_START = INNER / 2 + 14;

/**
 * Total balance in the middle of a ring of bars — one bar per day of the
 * month, its length the day's spending (longest day = longest bar). Days
 * still to come are shown faint. The written values (balance, spent, net)
 * carry the meaning; the bars are decorative.
 */
export function BalanceHero({
  balance,
  daily,
  spent,
  net,
  today,
}: {
  balance: Money | null;
  daily: DailySpending | null;
  spent: Money | null;
  net: Money | null;
  today: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const days = daily?.days ?? [];
  const max = Math.max(1, ...days.map((d) => d.spendingMinor));

  const label = [
    `${t('home.balance')}: ${balance ? formatter.money(balance) : t('balance.totalIncomplete')}`,
    spent ? `${t('home.spentThisMonth')}: ${formatter.money(spent)}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <View style={styles.wrap} accessible accessibilityLabel={label}>
      <View style={styles.dial} importantForAccessibility="no-hide-descendants">
        {days.map((d, i) => {
          const future = d.date > today;
          const length =
            d.spendingMinor > 0
              ? BAR_MIN + Math.round(((BAR_MAX - BAR_MIN) * d.spendingMinor) / max)
              : BAR_MIN;
          const angle = (i * 360) / days.length;
          return (
            <View
              key={d.date}
              style={[
                styles.bar,
                {
                  height: length,
                  left: SIZE / 2 - BAR_WIDTH / 2,
                  top: SIZE / 2 - length / 2,
                  backgroundColor: future
                    ? theme.colors.surfaceMuted
                    : d.spendingMinor > 0
                      ? d.spendingMinor >= max * 0.6
                        ? theme.colors.primaryPressed
                        : theme.colors.primary
                      : theme.colors.borderStrong,
                  transform: [{ rotate: `${angle}deg` }, { translateY: -(BAR_START + length / 2) }],
                },
              ]}
            />
          );
        })}
        <View style={styles.center}>
          <Text variant="overline" tone="textSecondary">
            {t('home.balance')}
          </Text>
          {balance ? (
            <MoneyText value={balance} variant="title" adjustsFontSizeToFit numberOfLines={1} />
          ) : (
            <Text variant="bodySmall" tone="textSecondary" align="center">
              {t('balance.totalIncomplete')}
            </Text>
          )}
          {net ? (
            <View style={styles.netRow}>
              <Icon
                name={net.amountMinor >= 0 ? 'caret-up' : 'caret-down'}
                size={12}
                tone={net.amountMinor >= 0 ? 'positive' : 'negative'}
              />
              <Text
                variant="caption"
                tone={net.amountMinor >= 0 ? 'positive' : 'negative'}
                numberOfLines={1}
              >
                {formatter.money(net, { signDisplay: 'exceptZero' })}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { alignItems: 'center' },
  dial: { width: SIZE, height: SIZE },
  bar: { position: 'absolute', width: BAR_WIDTH, borderRadius: BAR_WIDTH / 2 },
  center: {
    position: 'absolute',
    left: (SIZE - INNER) / 2,
    top: (SIZE - INNER) / 2,
    width: INNER,
    height: INNER,
    borderRadius: INNER / 2,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing.xxs,
    paddingHorizontal: t.spacing.md,
    ...t.elevation.medium,
  },
  netRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.xxs },
}));
