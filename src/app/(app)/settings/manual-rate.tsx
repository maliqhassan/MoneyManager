import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Card, Icon, OptionPicker, Screen, Text, TextField } from '@/components/ui';
import { type CurrencyCode, getMinorUnits, isCurrencyCode } from '@/domain/currency/currencies';
import { inverseRate } from '@/domain/fx/rateMath';
import { formatRateText, parseRateInput } from '@/domain/fx/rateText';
import { convert } from '@/domain/money/conversion';
import { money } from '@/domain/money/money';
import { FormError } from '@/features/auth/components/FormError';
import { useManualRateMutations } from '@/features/exchangeRates/hooks';
import { useCurrencyOptions } from '@/features/regional/options';
import { DateTimeField } from '@/features/transactions/components/DateTimeField';
import { useFormatter } from '@/i18n/FormatContext';
import { AppError } from '@/lib/errors';
import { useRepositories } from '@/providers/DataProvider';
import { showToast } from '@/stores/toastStore';
import { makeStyles } from '@/theme';

/**
 * Enter an exchange rate by hand: explicit currencies, effective date and
 * direction ("1 FROM = ? TO"), a live preview and an explicit review step.
 * Labelled as the user's own rate everywhere; never an official rate.
 */
export default function ManualRateScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const { exchangeRates } = useRepositories();
  const params = useLocalSearchParams<{ from?: string; to?: string }>();
  const options = useCurrencyOptions(formatter.numberLocale);
  const initial = (v: string | undefined): CurrencyCode | null =>
    v && isCurrencyCode(v) ? v : null;
  const [from, setFrom] = useState<CurrencyCode | null>(initial(params.from));
  const [to, setTo] = useState<CurrencyCode | null>(
    initial(params.to) ?? formatter.settings.baseCurrency,
  );
  const [date, setDate] = useState(formatter.today());
  const [rateText, setRateText] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { save } = useManualRateMutations();
  const sep = formatter.separators;
  const rate = parseRateInput(rateText, sep);

  // What already exists for this pair and date (for the review step).
  const existing = useQuery({
    queryKey: ['exchange_rates', 'manual-check', from, to, date],
    enabled: reviewing && !!from && !!to,
    queryFn: async () => {
      const [mine, provider] = await Promise.all([
        exchangeRates.findManualRate(from!, to!, date),
        exchangeRates.resolve(from!, to!, date, 'historical'),
      ]);
      return {
        mine,
        providerSameDay: provider?.kind === 'provider' && provider.rateDate === date,
      };
    },
  });

  const sameCurrency = from !== null && from === to;
  const rateError = rateText.trim() !== '' && rate === null ? t('validation.invalidRate') : null;
  const canReview = from !== null && to !== null && !sameCurrency && rate !== null;

  const example = (() => {
    if (!from || !to || !rate || sameCurrency) return null;
    const amount = money(100 * 10 ** getMinorUnits(from), from);
    try {
      return t('exchangeRates.manual.example', {
        amount: formatter.money(amount),
        converted: formatter.money(convert(amount, rate, to)),
      });
    } catch {
      return null;
    }
  })();

  const submit = () => {
    if (!from || !to || !rate) return;
    setError(null);
    save.mutate(
      {
        input: { base: from, quote: to, rate, rateDate: date },
        replace: Boolean(existing.data?.mine),
      },
      {
        onSuccess: () => {
          showToast(t('exchangeRates.manual.saved'), 'neutral');
          router.back();
        },
        onError: (e) => {
          setError(e);
          if (e instanceof AppError && e.code === 'validation') setReviewing(false);
        },
      },
    );
  };

  const rateLine =
    from && to && rate
      ? t('exchangeRates.manual.preview', { from, rate: formatRateText(rate, sep), to })
      : null;

  return (
    <Screen keyboard>
      <Text variant="body" tone="textSecondary">
        {t('exchangeRates.manual.intro')}
      </Text>

      {reviewing && from && to && rate ? (
        <Card>
          <View style={styles.group}>
            <Text variant="heading" accessibilityRole="header">
              {t('exchangeRates.manual.confirmTitle')}
            </Text>
            <Text variant="bodyStrong">
              {t('exchangeRates.manual.confirmBody', {
                from,
                rate: formatRateText(rate, sep),
                to,
                date: formatter.date(date, 'medium'),
              })}
            </Text>
            {example ? (
              <Text variant="bodySmall" tone="textSecondary">
                {example}
              </Text>
            ) : null}
            {existing.data?.mine ? (
              <View style={styles.inline}>
                <Icon name="alert-circle-outline" size={18} tone="warning" />
                <Text variant="bodySmall" style={styles.flex}>
                  {t('exchangeRates.manual.replaceBody', {
                    old: formatRateText(existing.data.mine.rate, sep),
                  })}
                </Text>
              </View>
            ) : null}
            {existing.data?.providerSameDay ? (
              <Text variant="bodySmall" tone="textSecondary">
                {t('exchangeRates.manual.providerNote')}
              </Text>
            ) : null}
            <Text variant="caption" tone="textSecondary">
              {t('exchangeRates.manual.futureNote')}
            </Text>
            <FormError error={error} />
            <Button
              label={
                existing.data?.mine
                  ? t('exchangeRates.manual.replace')
                  : t('exchangeRates.manual.save')
              }
              icon="checkmark"
              loading={save.isPending || existing.isLoading}
              disabled={existing.isLoading}
              onPress={submit}
            />
            <Button
              label={t('exchangeRates.manual.edit')}
              variant="ghost"
              onPress={() => setReviewing(false)}
            />
          </View>
        </Card>
      ) : (
        <>
          <OptionPicker
            label={t('exchangeRates.manual.from')}
            value={from}
            options={options}
            onChange={setFrom}
            searchable
          />
          <OptionPicker
            label={t('exchangeRates.manual.to')}
            value={to}
            options={options}
            onChange={setTo}
            searchable
          />
          {sameCurrency ? (
            <Text variant="bodySmall" tone="negative">
              {t('validation.sameCurrency')}
            </Text>
          ) : null}
          <View style={styles.group}>
            <DateTimeField
              label={t('exchangeRates.manual.date')}
              date={date}
              time="12:00"
              showTime={false}
              onChange={(next) => setDate(next.date)}
            />
            <Text variant="caption" tone="textSecondary">
              {t('exchangeRates.manual.dateHint')}
            </Text>
          </View>
          <TextField
            label={t('exchangeRates.manual.rate')}
            value={rateText}
            onChangeText={setRateText}
            keyboardType="decimal-pad"
            inputMode="decimal"
            autoCorrect={false}
            prefix={from ? `1 ${from} =` : undefined}
            trailing={to ? <Text variant="body">{to}</Text> : undefined}
            hint={from && to ? t('exchangeRates.manual.rateHint', { from, to }) : undefined}
            error={rateError}
            footer={
              rateLine ? (
                <View style={styles.preview}>
                  <Text variant="bodySmall" tone="textSecondary">
                    {rateLine}
                  </Text>
                  {from && to && rate && !sameCurrency ? (
                    <Text variant="caption" tone="textSecondary">
                      {t('exchangeRates.manual.inverse', {
                        from,
                        to,
                        rate: formatRateText(inverseRate(rate), sep),
                      })}
                    </Text>
                  ) : null}
                  {example ? (
                    <Text variant="caption" tone="textSecondary">
                      {example}
                    </Text>
                  ) : null}
                </View>
              ) : undefined
            }
          />
          <FormError error={error} />
          <Button
            label={t('exchangeRates.manual.review')}
            disabled={!canReview}
            onPress={() => {
              setError(null);
              setReviewing(true);
            }}
          />
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  group: { gap: t.spacing.sm },
  preview: { gap: t.spacing.xxs },
  inline: { flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
}));
