import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, ChoiceChips, MultiChoiceChips, Screen, Text, TextField } from '@/components/ui';
import { addDays, addMonths } from '@/domain/dates/calendar';
import { TRANSACTION_TYPES, type TransactionType } from '@/domain/enums';
import { formatDecimal } from '@/domain/money/decimal';
import { parseAmountEntry } from '@/domain/money/parse';
import { useAccounts } from '@/features/accounts/hooks/useAccounts';
import { useCategories, useCategoryName, useTags } from '@/features/categories/hooks';
import { DateTimeField } from '@/features/transactions/components/DateTimeField';
import {
  EMPTY_FILTERS,
  type TransactionFilterState,
  useTransactionFilters,
} from '@/features/transactions/filterStore';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles } from '@/theme';

type Preset = 'any' | 'this_month' | 'last_30' | 'custom';

/** Typed amount (user number format) → canonical decimal string ("12.5"), or null. */
function canonicalAmount(text: string, decimal: string): string | null {
  if (!text.trim()) return null;
  const parsed = parseAmountEntry(text, 'KWD', decimal); // 3 decimals: enough precision for any currency
  if (!parsed.ok || parsed.value.amountMinor < 0) return null;
  return formatDecimal({ coefficient: BigInt(parsed.value.amountMinor), scale: 3 });
}

/** Filter sheet: edits a draft and applies it on "Show results". Works offline. */
export default function TransactionFiltersScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const name = useCategoryName();
  const { filters, apply } = useTransactionFilters();
  const [draft, setDraft] = useState<TransactionFilterState>(filters);
  const [preset, setPreset] = useState<Preset>(filters.from || filters.to ? 'custom' : 'any');
  const [minText, setMinText] = useState(filters.minAmount);
  const [maxText, setMaxText] = useState(filters.maxAmount);
  const accounts = useAccounts({ includeArchived: true });
  const categories = useCategories({ includeArchived: false });
  const tags = useTags();
  const today = formatter.today();
  const decimal = formatter.separators.decimal;
  const patch = (p: Partial<TransactionFilterState>) => setDraft((d) => ({ ...d, ...p }));

  const topCategories = useMemo(
    () => (categories.data ?? []).filter((c) => !c.parentId),
    [categories.data],
  );

  const setRange = (next: Preset) => {
    setPreset(next);
    if (next === 'any') patch({ from: null, to: null });
    if (next === 'this_month') patch({ from: `${today.slice(0, 8)}01`, to: today });
    if (next === 'last_30') patch({ from: addDays(today, -29), to: today });
    if (next === 'custom')
      patch({ from: draft.from ?? addMonths(today, -1), to: draft.to ?? today });
  };

  const minInvalid = minText.trim() !== '' && canonicalAmount(minText, decimal) === null;
  const maxInvalid = maxText.trim() !== '' && canonicalAmount(maxText, decimal) === null;

  return (
    <Screen
      keyboard
      footer={
        <View style={styles.footer}>
          <View style={styles.flex}>
            <Button
              label={t('filters.clearAll')}
              variant="secondary"
              onPress={() => {
                setDraft({ ...EMPTY_FILTERS, search: filters.search });
                setPreset('any');
                setMinText('');
                setMaxText('');
              }}
            />
          </View>
          <View style={styles.flex}>
            <Button
              label={t('filters.apply')}
              disabled={minInvalid || maxInvalid}
              onPress={() => {
                const { search: _search, ...rest } = draft;
                apply({
                  ...rest,
                  minAmount: canonicalAmount(minText, decimal) ?? '',
                  maxAmount: canonicalAmount(maxText, decimal) ?? '',
                });
                router.back();
              }}
            />
          </View>
        </View>
      }
    >
      <MultiChoiceChips
        label={t('filters.types')}
        values={draft.types}
        onChange={(types) => patch({ types: types as TransactionType[] })}
        choices={TRANSACTION_TYPES.map((value) => ({
          value,
          label: t(`transactions.types.${value}`),
        }))}
      />

      <MultiChoiceChips
        label={t('filters.accounts')}
        values={draft.accountIds}
        onChange={(accountIds) => patch({ accountIds })}
        choices={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
      />

      <MultiChoiceChips
        label={t('filters.categories')}
        values={draft.categoryIds}
        onChange={(categoryIds) => patch({ categoryIds })}
        choices={topCategories.map((c) => ({ value: c.id, label: name(c) }))}
      />

      <ChoiceChips
        label={t('filters.dateRange')}
        value={preset}
        onChange={setRange}
        choices={[
          { value: 'any', label: t('filters.anyDate') },
          { value: 'this_month', label: t('filters.thisMonth') },
          { value: 'last_30', label: t('filters.last30') },
          { value: 'custom', label: t('filters.custom') },
        ]}
      />
      {preset === 'custom' && draft.from && draft.to ? (
        <View style={styles.dates}>
          <Text variant="label" tone="textSecondary">
            {t('filters.from')}
          </Text>
          <DateTimeField
            showTime={false}
            date={draft.from}
            time="00:00"
            onChange={({ date }) => patch({ from: date })}
          />
          <Text variant="label" tone="textSecondary">
            {t('filters.to')}
          </Text>
          <DateTimeField
            showTime={false}
            date={draft.to}
            time="00:00"
            onChange={({ date }) => patch({ to: date })}
          />
        </View>
      ) : null}

      <View style={styles.amounts}>
        <View style={styles.flex}>
          <TextField
            label={t('filters.minAmount')}
            value={minText}
            onChangeText={setMinText}
            keyboardType="decimal-pad"
            error={minInvalid ? t('validation.invalidAmount') : null}
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label={t('filters.maxAmount')}
            value={maxText}
            onChangeText={setMaxText}
            keyboardType="decimal-pad"
            error={maxInvalid ? t('validation.invalidAmount') : null}
          />
        </View>
      </View>

      {(tags.data ?? []).length > 0 ? (
        <MultiChoiceChips
          label={t('filters.tags')}
          values={draft.tagNames}
          onChange={(tagNames) => patch({ tagNames })}
          choices={(tags.data ?? []).map((tag) => ({ value: tag.name, label: tag.name }))}
        />
      ) : (
        <Text variant="bodySmall" tone="textMuted">
          {t('filters.noTags')}
        </Text>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  footer: { flexDirection: 'row', gap: t.spacing.sm },
  flex: { flex: 1 },
  dates: { gap: t.spacing.xs },
  amounts: { flexDirection: 'row', gap: t.spacing.sm },
}));
