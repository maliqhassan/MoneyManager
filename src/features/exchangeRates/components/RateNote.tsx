import { type Href, router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Icon, Text } from '@/components/ui';
import type { ConversionNote, RateUsage } from '@/domain/fx/note';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles } from '@/theme';

/** "Frankfurter", "Your rate" or both, for a set of rate sources. */
export function sourceLabel(t: TFunction, sources: readonly string[]): string {
  const manual = sources.includes('manual');
  const provider = sources.some((s) => s !== 'manual' && s !== 'identity');
  if (manual && provider) return t('exchangeRates.sources.mixed');
  return manual ? t('exchangeRates.sources.manual') : t('exchangeRates.sources.provider');
}

export interface RateNoteProps {
  note: ConversionNote;
  /** Extra line explaining the policy (e.g. "valued at the rate on its date"). */
  policy?: string;
  /** Show the link to the Exchange rates screen (default when something is missing/stale). */
  showManage?: boolean;
  /** False when the card already explains the missing currencies itself. */
  showMissing?: boolean;
}

/**
 * Says what a converted total is based on: the currency it was converted
 * into, the rate dates and sources, stale or user-entered rates, and which
 * currencies are missing. Renders nothing for single-currency totals.
 */
export function RateNote({ note, policy, showManage, showMissing = true }: RateNoteProps) {
  const { t } = useTranslation();
  const formatter = useFormatter();
  const styles = useStyles();
  if (!note.converted && note.missing.length === 0) return null;

  const rateLine = (r: RateUsage) =>
    r.oldestRateDate === r.newestRateDate
      ? t('exchangeRates.note.rateOn', {
          currency: r.currency,
          date: formatter.date(r.oldestRateDate, 'medium'),
          source: sourceLabel(t, r.sources),
        })
      : t('exchangeRates.note.rateRange', {
          currency: r.currency,
          from: formatter.date(r.oldestRateDate, 'medium'),
          to: formatter.date(r.newestRateDate, 'medium'),
          source: sourceLabel(t, r.sources),
        });
  const needsAttention = note.missing.length > 0 || note.stale;

  return (
    <View style={styles.box} accessibilityRole="text">
      {note.converted ? (
        <View style={styles.row}>
          <Icon name="swap-horizontal-outline" size={16} tone="textSecondary" />
          <Text variant="caption" tone="textSecondary" style={styles.flex}>
            {t('exchangeRates.note.convertedTo', { base: note.target })}
            {policy ? ` · ${policy}` : ''}
          </Text>
        </View>
      ) : null}
      {note.rates.map((r) => (
        <Text key={r.currency} variant="caption" tone="textSecondary">
          {rateLine(r)}
        </Text>
      ))}
      {note.snapshotCount > 0 ? (
        <Text variant="caption" tone="textSecondary">
          {t('exchangeRates.note.snapshot')}
        </Text>
      ) : null}
      {note.rates.some((r) => r.manual) ? (
        <Text variant="caption" tone="textSecondary">
          {t('exchangeRates.note.manual')}
        </Text>
      ) : null}
      {note.stale ? (
        <View style={styles.row}>
          <Icon name="time-outline" size={16} tone="warning" />
          <Text variant="caption" tone="warning" style={styles.flex}>
            {t('exchangeRates.note.stale')}
          </Text>
        </View>
      ) : null}
      {showMissing && note.missing.length > 0 ? (
        <View style={styles.row}>
          <Icon name="alert-circle-outline" size={16} tone="warning" />
          <Text variant="caption" tone="warning" style={styles.flex}>
            {t('exchangeRates.note.missing', { currencies: note.missing.join(', ') })}
          </Text>
        </View>
      ) : null}
      {(showManage ?? needsAttention) ? (
        <Button
          label={t('exchangeRates.note.manage')}
          icon="swap-horizontal-outline"
          variant="ghost"
          size="md"
          onPress={() => router.push('/settings/exchange-rates' as Href)}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  box: { gap: t.spacing.xs },
  row: { flexDirection: 'row', gap: t.spacing.xs, alignItems: 'flex-start' },
  flex: { flex: 1 },
}));
