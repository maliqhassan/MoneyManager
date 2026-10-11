import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card, Icon, OptionPicker, Text } from '@/components/ui';
import type { CurrencyCode } from '@/domain/currency/currencies';
import { compareDates, parseCalendarDate } from '@/domain/dates/calendar';
import { type Change, compareAmounts, type Excluded } from '@/domain/reports/aggregate';
import { type DateRange, REPORT_PERIODS, type ResolvedPeriod } from '@/domain/reports/periods';
import { DateTimeField } from '@/features/transactions/components/DateTimeField';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles } from '@/theme';

import { useReportPeriodStore } from '../periodStore';

/** "1 Oct 2026 – 11 Oct 2026" using the user's date format. */
export function useRangeLabel() {
  const { t } = useTranslation();
  const formatter = useFormatter();
  return (r: DateRange) =>
    t('home.periodRange', {
      from: formatter.date(r.start, 'medium'),
      to: formatter.date(r.end, 'medium'),
    });
}

/** Month names in the user's locale ("Oct", "October 2026"); display only. */
export function useMonthNames() {
  const formatter = useFormatter();
  return useMemo(() => {
    const short = new Intl.DateTimeFormat(formatter.settings.locale, {
      month: 'short',
      timeZone: 'UTC',
    });
    const long = new Intl.DateTimeFormat(formatter.settings.locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const at = (month: string) => {
      const { year, month: m } = parseCalendarDate(`${month}-01`);
      return new Date(Date.UTC(year, m - 1, 15));
    };
    return {
      short: (month: string) => short.format(at(month)),
      long: (month: string) => long.format(at(month)),
    };
  }, [formatter.settings.locale]);
}

/** Period preset picker; custom dates are always kept in order (start ≤ end). */
export function PeriodPicker({ period }: { period: ResolvedPeriod }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const rangeLabel = useRangeLabel();
  const setPreset = useReportPeriodStore((s) => s.setPreset);
  const setCustom = useReportPeriodStore((s) => s.setCustom);
  const { range } = period;

  return (
    <Card>
      <View style={styles.body}>
        <OptionPicker
          label={t('reports.period')}
          value={period.preset}
          options={REPORT_PERIODS.map((value) => ({
            value,
            label: t(`reports.periods.${value}`),
          }))}
          onChange={(preset) => {
            if (preset === 'custom') setCustom(range.start, range.end);
            else setPreset(preset);
          }}
        />
        {period.preset === 'custom' ? (
          <View style={styles.row}>
            <View style={styles.flex}>
              <DateTimeField
                label={t('reports.from')}
                date={range.start}
                time="00:00"
                showTime={false}
                onChange={({ date }) =>
                  // Moving the start past the end moves the end with it.
                  setCustom(date, compareDates(date, range.end) > 0 ? date : range.end)
                }
              />
            </View>
            <View style={styles.flex}>
              <DateTimeField
                label={t('reports.to')}
                date={range.end}
                time="00:00"
                showTime={false}
                onChange={({ date }) =>
                  setCustom(compareDates(date, range.start) < 0 ? date : range.start, date)
                }
              />
            </View>
          </View>
        ) : (
          <Text variant="bodyStrong">{rangeLabel(range)}</Text>
        )}
        <Text variant="bodySmall" tone="textSecondary">
          {t('reports.comparedWith', { range: rangeLabel(period.previous) })}
        </Text>
        {period.toDate ? (
          <Text variant="caption" tone="textMuted">
            {t('reports.toDateNote')}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/** Written comparison with the previous period (never colour-only). */
export function ChangeLine({
  current,
  previous,
  comparable,
  currency,
}: {
  current: number;
  previous: number;
  comparable: boolean;
  currency: CurrencyCode;
}) {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const change: Change | null = compareAmounts(current, previous, comparable);
  let text: string;
  let icon: 'arrow-up' | 'arrow-down' | 'remove' | 'information-circle-outline';
  if (!change) {
    text = t('reports.change.unavailable');
    icon = 'information-circle-outline';
  } else if (change.changeBasisPoints === null) {
    text = t('reports.change.fromZero', {
      amount: formatter.money({ amountMinor: previous, currency }),
    });
    icon = 'information-circle-outline';
  } else if (change.deltaMinor === 0) {
    text = t('reports.change.same');
    icon = 'remove';
  } else {
    const percent = formatter.percent(Math.abs(change.changeBasisPoints), 0);
    text =
      change.deltaMinor > 0
        ? t('reports.change.up', { percent })
        : t('reports.change.down', { percent });
    icon = change.deltaMinor > 0 ? 'arrow-up' : 'arrow-down';
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={icon} size={14} tone="textSecondary" />
      <Text variant="caption" tone="textSecondary" style={{ flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/** Amounts left out of a total because no exchange rate is known. */
export function ExcludedNote({ excluded }: { excluded: readonly Excluded[] }) {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const styles = useStyles();
  if (excluded.length === 0) return null;
  const amounts = excluded
    .map((e) => formatter.money({ amountMinor: e.amountMinor, currency: e.currency }))
    .join(', ');
  return (
    <View style={styles.notice} accessibilityRole="text">
      <Icon name="information-circle-outline" size={16} tone="warning" />
      <Text variant="caption" tone="textSecondary" style={styles.flex}>
        {t('reports.excluded', { amounts })}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  body: { gap: t.spacing.sm },
  row: { flexDirection: 'row', gap: t.spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 140 },
  notice: { flexDirection: 'row', gap: t.spacing.xs, alignItems: 'flex-start' },
}));
