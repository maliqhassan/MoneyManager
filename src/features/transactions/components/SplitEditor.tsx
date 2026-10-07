import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { translateMessage } from '@/components/form/translateMessage';
import { Button, Card, Divider, IconButton, MoneyText, Text, TextField } from '@/components/ui';
import type { CurrencyCode } from '@/domain/currency/currencies';
import type { CategoryKind } from '@/domain/enums';
import { CategoryPickerField } from '@/features/categories/components/CategoryPickerField';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles } from '@/theme';

import { type SplitLineValues, splitTotals } from '../formSchema';

export interface SplitEditorProps {
  amount: string;
  currency: CurrencyCode;
  kind: CategoryKind;
  lines: SplitLineValues[];
  onChange: (lines: SplitLineValues[]) => void;
  newKey: () => string;
  /** Translated-on-render error keys: `splits`, `splits.<i>.categoryId`, `splits.<i>.amount`. */
  errors: Record<string, string | undefined>;
}

/**
 * Split editor with a live Total / Allocated / Remaining summary computed in
 * exact minor units. Saving is only possible when Remaining is exactly zero.
 */
export function SplitEditor({
  amount,
  currency,
  kind,
  lines,
  onChange,
  newKey,
  errors,
}: SplitEditorProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const decimal = formatter.separators.decimal;
  const totals = splitTotals(amount, lines, currency, decimal);
  const m = (minor: number) => ({ amountMinor: minor, currency });
  const remaining = totals.remainingMinor;

  const update = (index: number, patch: Partial<SplitLineValues>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  return (
    <View style={styles.container}>
      <Card>
        <View
          style={styles.summary}
          accessible
          accessibilityRole="summary"
          accessibilityLiveRegion="polite"
        >
          <View style={styles.summaryRow}>
            <Text variant="bodySmall" tone="textSecondary">
              {t('transactions.split.total')}
            </Text>
            <MoneyText value={m(totals.totalMinor)} />
          </View>
          <View style={styles.summaryRow}>
            <Text variant="bodySmall" tone="textSecondary">
              {t('transactions.split.allocated')}
            </Text>
            <MoneyText value={m(totals.allocatedMinor)} />
          </View>
          <Divider />
          <View style={styles.summaryRow}>
            <Text
              variant="bodyStrong"
              tone={remaining === 0 ? 'positive' : remaining < 0 ? 'negative' : 'text'}
            >
              {remaining === 0
                ? t('transactions.split.complete')
                : remaining < 0
                  ? t('transactions.split.over')
                  : t('transactions.split.remaining')}
            </Text>
            <MoneyText value={m(Math.abs(remaining))} variant="bodyStrong" />
          </View>
        </View>
      </Card>

      {lines.map((line, index) => (
        <View key={line.key} style={styles.line}>
          <View style={styles.lineHeader}>
            <Text variant="label" tone="textSecondary">
              {t('transactions.split.line', { index: index + 1 })}
            </Text>
            <IconButton
              icon="trash-outline"
              tone="negative"
              accessibilityLabel={t('transactions.split.removeLine', { index: index + 1 })}
              onPress={() => onChange(lines.filter((_, i) => i !== index))}
            />
          </View>
          <CategoryPickerField
            label={t('transactions.fields.category')}
            kind={kind}
            value={line.categoryId}
            onChange={(categoryId) => update(index, { categoryId })}
            error={
              errors[`splits.${index}.categoryId`]
                ? translateMessage(t, errors[`splits.${index}.categoryId`]!)
                : null
            }
          />
          <TextField
            label={t('transactions.fields.amount')}
            value={line.amount}
            onChangeText={(value) => update(index, { amount: value })}
            keyboardType="decimal-pad"
            prefix={formatter.currencySymbol(currency)}
            error={
              errors[`splits.${index}.amount`]
                ? translateMessage(t, errors[`splits.${index}.amount`]!)
                : null
            }
            trailing={
              remaining > 0 ? (
                <Button
                  label={t('transactions.split.fillRemaining')}
                  variant="ghost"
                  size="md"
                  fullWidth={false}
                  onPress={() => {
                    const current = splitTotals(line.amount, [], currency, decimal).totalMinor;
                    update(index, { amount: formatter.amountForInput(m(current + remaining)) });
                  }}
                />
              ) : null
            }
          />
        </View>
      ))}

      {errors.splits ? (
        <Text variant="bodySmall" tone="negative" accessibilityLiveRegion="polite">
          {translateMessage(t, errors.splits)}
        </Text>
      ) : null}
      <Button
        label={t('transactions.split.addLine')}
        icon="add"
        variant="secondary"
        size="md"
        onPress={() => onChange([...lines, { key: newKey(), categoryId: null, amount: '' }])}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.md },
  summary: { gap: t.spacing.xs },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 28,
  },
  line: {
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  lineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
}));
