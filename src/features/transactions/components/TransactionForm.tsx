import { zodResolver } from '@hookform/resolvers/zod';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Keyboard, Pressable, View } from 'react-native';

import { translateMessage } from '@/components/form/translateMessage';
import { Button, FormGroup, FormInputRow, Icon, Screen, SwitchRow, Text } from '@/components/ui';
import { getMinorUnits } from '@/domain/currency/currencies';
import type { Account } from '@/domain/models';
import { normalizeMerchant } from '@/domain/merchants/normalize';
import { evaluateExpression, type KeypadKey, pressKey } from '@/domain/money/keypad';
import { canSplit, categoryKindFor } from '@/domain/transactions/transactions';
import { FormError } from '@/features/auth/components/FormError';
import { CategoryDial } from '@/features/categories/components/CategoryDial';
import { useCategories, useCategoryName } from '@/features/categories/hooks';
import { useKeyboardVisible } from '@/hooks/useKeyboard';
import { useFormatter } from '@/i18n/FormatContext';
import { toAppError } from '@/lib/errors';
import { makeStyles, useTheme } from '@/theme';
import type { ReceiptFile } from '@/validation/transactions';

import { createTransactionFormSchema, type TransactionFormValues } from '../formSchema';
import { useCategorySuggestion } from '../hooks';
import { AccountPickerField } from './AccountPickerField';
import { AmountKeypad } from './AmountKeypad';
import { DateTimeField } from './DateTimeField';
import { pickReceipt, ReceiptField, type ReceiptItem } from './ReceiptField';
import { RefundLinkField } from './RefundLinkField';
import { SplitEditor } from './SplitEditor';
import { TagInput } from './TagInput';

export interface TransactionFormProps {
  initialValues: TransactionFormValues;
  accounts: readonly Account[];
  submitLabel: string;
  onSubmit: (values: TransactionFormValues) => Promise<void>;
  receipts: readonly ReceiptItem[];
  onAddReceipt: (file: ReceiptFile) => void | Promise<void>;
  onRemoveReceipt: (item: ReceiptItem) => void;
  /** Shown above the dial (e.g. the Expense / Income / Transfer switch). */
  header?: ReactNode;
}

/** Repository field errors → form fields (so e.g. "account archived" shows on the field). */
const FIELD_MAP: Record<string, keyof TransactionFormValues> = {
  accountId: 'accountId',
  categoryId: 'categoryId',
  splits: 'splits',
  amountMinor: 'amount',
  refundOfTransactionId: 'refundOfTransactionId',
};

/**
 * Entry in one screen: the amount in the middle of a dial of likely
 * categories, a keypad pinned at the bottom, and account / date / merchant /
 * note as rows. Tags, split, receipts and "remember category" follow. The
 * Save button says "Enter an amount" until there is one. The system keyboard
 * replaces the keypad while a text field is being edited.
 */
export function TransactionForm({
  initialValues,
  accounts,
  submitLabel,
  onSubmit,
  receipts,
  onAddReceipt,
  onRemoveReceipt,
  header,
}: TransactionFormProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const categoryName = useCategoryName();
  const decimal = formatter.separators.decimal;
  const keySeq = useRef(0);
  const newKey = () => `new-${(keySeq.current += 1)}`;
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [userPickedCategory, setUserPickedCategory] = useState(false);
  const [expr, setExpr] = useState(initialValues.amount);
  const [showMore, setShowMore] = useState(initialValues.isSplit || receipts.length > 0);
  const keyboardVisible = useKeyboardVisible();

  const currencyOf = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.id, a.currency]));
    return (id: string) => map.get(id) ?? null;
  }, [accounts]);
  const schema = useMemo(
    () => createTransactionFormSchema({ decimal, currencyOf }),
    [decimal, currencyOf],
  );

  const { control, handleSubmit, setValue, setError, formState } = useForm<TransactionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: 'onSubmit',
  });
  const [type, accountId, amount, payee, notes, categoryId, isSplit, splits] = useWatch({
    control,
    name: ['type', 'accountId', 'amount', 'payee', 'notes', 'categoryId', 'isSplit', 'splits'],
  });
  const kind = categoryKindFor(type) ?? 'expense';
  const currency = currencyOf(accountId) ?? formatter.settings.baseCurrency;
  const merchantKey = normalizeMerchant(payee);
  const categories = useCategories({ kind, includeArchived: true });
  const selectedCategory = categories.data?.find((c) => c.id === categoryId) ?? null;

  // Deterministic suggestion fills the category only while the user hasn't chosen one.
  const suggestion = useCategorySuggestion(payee, notes, isSplit ? null : kind);
  useEffect(() => {
    const s = suggestion.data;
    if (s && !categoryId && !isSplit && !userPickedCategory) setValue('categoryId', s.categoryId);
  }, [suggestion.data, categoryId, isSplit, userPickedCategory, setValue]);
  // Shown while the selected category is the one the suggestion supplied.
  const suggestionSource =
    !userPickedCategory && suggestion.data && suggestion.data.categoryId === categoryId
      ? suggestion.data.source
      : null;

  /** The form stores the amount as text the schema parses exactly. */
  const syncAmount = (nextExpr: string, nextCurrency: typeof currency) => {
    const result = evaluateExpression(nextExpr, nextCurrency, formatter.separators);
    setValue('amount', result.ok ? formatter.amountForInput(result.value) : nextExpr, {
      shouldValidate: formState.isSubmitted,
    });
  };
  const onKey = (key: KeypadKey) => {
    const next = pressKey(expr, key, currency, decimal);
    setExpr(next);
    syncAmount(next, currency);
  };
  const evaluated = evaluateExpression(expr, currency, formatter.separators);
  const hasAmount = evaluated.ok && evaluated.value.amountMinor > 0;
  const amountText = evaluated.ok
    ? formatter.money(evaluated.value)
    : formatter.money({ amountMinor: 0, currency });

  const errorText = (key: string | undefined) => (key ? translateMessage(t, key) : null);
  const splitErrors = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    const e = formState.errors.splits;
    if (e?.message) out.splits = e.message;
    if (e?.root?.message) out.splits = e.root.message;
    if (Array.isArray(e)) {
      e.forEach((line, i) => {
        if (line?.categoryId?.message) out[`splits.${i}.categoryId`] = line.categoryId.message;
        if (line?.amount?.message) out[`splits.${i}.amount`] = line.amount.message;
      });
    }
    return out;
  }, [formState.errors.splits]);

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      const fieldErrors = toAppError(error).fieldErrors;
      let mapped = false;
      for (const [field, key] of Object.entries(fieldErrors ?? {})) {
        const target = FIELD_MAP[field.split('.')[0] ?? field];
        if (target) {
          setError(target, { message: key });
          mapped = true;
        }
      }
      if (!mapped) setSubmitError(error);
    }
  });

  const scanReceipt = async () => {
    try {
      const file = await pickReceipt('camera');
      if (!file) return;
      await onAddReceipt(file);
      setShowMore(true);
    } catch (error) {
      setSubmitError(error);
    }
  };

  const amountError = errorText(formState.errors.amount?.message);
  const amountLabel = t('transactions.fields.amount');
  const caption = t('transactions.dialCaption', {
    type: t(`transactions.types.${type}`),
    category: selectedCategory
      ? categoryName(selectedCategory)
      : t('transactions.fields.chooseCategory'),
  });

  const amountCenter = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${amountLabel}: ${amountText}`}
      accessibilityHint={amountError ?? t('keypad.openHint')}
      onPress={() => Keyboard.dismiss()}
      style={styles.amountCenter}
      testID="amount-display"
    >
      <Text
        variant="amountLarge"
        tone={hasAmount ? 'text' : 'textMuted'}
        numberOfLines={1}
        adjustsFontSizeToFit
        align="center"
      >
        {amountText}
      </Text>
      <Text variant="overline" tone="textSecondary" numberOfLines={2} align="center">
        {isSplit ? t(`transactions.types.${type}`) : caption}
      </Text>
    </Pressable>
  );

  const footer = (
    <View style={styles.footer}>
      {!keyboardVisible ? (
        <AmountKeypad decimal={decimal} allowDecimal={getMinorUnits(currency) > 0} onKey={onKey} />
      ) : null}
      <Button
        label={hasAmount ? submitLabel : t('transactions.enterAmount')}
        loading={formState.isSubmitting}
        disabled={!hasAmount}
        onPress={submit}
      />
    </View>
  );

  return (
    <Screen keyboard footer={footer}>
      {header}

      {isSplit && canSplit(type) ? (
        <View style={styles.splitAmount}>{amountCenter}</View>
      ) : (
        <Controller
          control={control}
          name="categoryId"
          render={({ field }) => (
            <CategoryDial
              label={t('transactions.fields.category')}
              kind={kind}
              value={field.value}
              onChange={(id) => {
                field.onChange(id);
                setUserPickedCategory(true);
              }}
              center={amountCenter}
            />
          )}
        />
      )}
      {amountError ? (
        <Text variant="bodySmall" tone="negative" align="center" accessibilityLiveRegion="polite">
          {amountError}
        </Text>
      ) : null}
      {formState.errors.categoryId?.message && !isSplit ? (
        <Text variant="bodySmall" tone="negative" align="center">
          {errorText(formState.errors.categoryId.message)}
        </Text>
      ) : !isSplit ? (
        <Text variant="caption" tone="textMuted" align="center">
          {suggestionSource && selectedCategory
            ? suggestionSource === 'rule'
              ? t('transactions.suggestion.rule')
              : t('transactions.suggestion.history')
            : t('transactions.dialHint')}
        </Text>
      ) : null}

      {isSplit && canSplit(type) ? (
        <Controller
          control={control}
          name="splits"
          render={({ field }) => (
            <SplitEditor
              amount={amount}
              currency={currency}
              kind={kind}
              lines={field.value}
              onChange={field.onChange}
              newKey={newKey}
              errors={splitErrors}
            />
          )}
        />
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void scanReceipt()}
          style={({ pressed }) => [
            styles.actionButton,
            pressed && { backgroundColor: theme.colors.surfaceMuted },
          ]}
        >
          <Icon name="scan-outline" size={18} tone="text" />
          <Text variant="label">{t('transactions.addReceipt')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showMore }}
          onPress={() => setShowMore((v) => !v)}
          style={({ pressed }) => [
            styles.actionButton,
            pressed && { backgroundColor: theme.colors.surfaceMuted },
          ]}
        >
          <Icon name="options-outline" size={18} tone="text" />
          <Text variant="label">{t('transactions.moreOptions')}</Text>
        </Pressable>
      </View>

      <FormGroup>
        <Controller
          control={control}
          name="accountId"
          render={({ field }) => (
            <AccountPickerField
              label={t('transactions.fields.account')}
              accounts={accounts}
              value={field.value}
              variant="row"
              onChange={(id) => {
                field.onChange(id);
                syncAmount(expr, currencyOf(id) ?? currency);
              }}
            />
          )}
        />
        <Controller
          control={control}
          name="localDate"
          render={({ field }) => (
            <Controller
              control={control}
              name="localTime"
              render={({ field: timeField }) => (
                <DateTimeField
                  variant="row"
                  date={field.value}
                  time={timeField.value}
                  onChange={({ date, time }) => {
                    field.onChange(date);
                    timeField.onChange(time);
                  }}
                />
              )}
            />
          )}
        />
        <Controller
          control={control}
          name="payee"
          render={({ field }) => (
            <FormInputRow
              label={
                type === 'income'
                  ? t('transactions.fields.source')
                  : t('transactions.fields.merchant')
              }
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('transactions.payeePlaceholder')}
              autoCapitalize="words"
              maxLength={200}
              returnKeyType="next"
            />
          )}
        />
        <Controller
          control={control}
          name="notes"
          render={({ field }) => (
            <FormInputRow
              label={t('transactions.note')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('transactions.notePlaceholder')}
              maxLength={1000}
            />
          )}
        />
      </FormGroup>
      {formState.errors.accountId?.message ? (
        <Text variant="bodySmall" tone="negative">
          {errorText(formState.errors.accountId.message)}
        </Text>
      ) : null}

      <Controller
        control={control}
        name="tagNames"
        render={({ field }) => <TagInput value={field.value} onChange={field.onChange} />}
      />

      {type === 'refund' ? (
        <Controller
          control={control}
          name="refundOfTransactionId"
          render={({ field }) => <RefundLinkField value={field.value} onChange={field.onChange} />}
        />
      ) : null}

      {merchantKey && selectedCategory && !isSplit ? (
        <Controller
          control={control}
          name="rememberCategory"
          render={({ field }) => (
            <SwitchRow
              label={t('transactions.fields.rememberCategory', { merchant: payee.trim() })}
              hint={categoryName(selectedCategory)}
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />
      ) : null}

      {showMore ? (
        <View style={styles.more}>
          {canSplit(type) ? (
            <Controller
              control={control}
              name="isSplit"
              render={({ field }) => (
                <SwitchRow
                  label={t('transactions.split.toggle')}
                  value={field.value}
                  onValueChange={(on) => {
                    field.onChange(on);
                    if (on && splits.length === 0) {
                      setValue('splits', [
                        { key: newKey(), categoryId, amount },
                        { key: newKey(), categoryId: null, amount: '' },
                      ]);
                    }
                  }}
                />
              )}
            />
          ) : null}
          <ReceiptField items={receipts} onAdd={onAddReceipt} onRemove={onRemoveReceipt} />
        </View>
      ) : null}

      <FormError error={submitError} />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  amountCenter: { alignItems: 'center', gap: t.spacing.xxs, width: '100%' },
  splitAmount: {
    alignItems: 'center',
    paddingVertical: t.spacing.lg,
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  actions: { flexDirection: 'row', gap: t.spacing.sm },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing.sm,
    minHeight: t.minTouchTarget,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  more: { gap: t.spacing.lg },
  footer: { gap: t.spacing.sm },
}));
