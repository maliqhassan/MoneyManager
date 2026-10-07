import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormTextField } from '@/components/form/FormTextField';
import { translateMessage } from '@/components/form/translateMessage';
import { Button, SwitchRow, Text, TextField } from '@/components/ui';
import type { Account } from '@/domain/models';
import { normalizeMerchant } from '@/domain/merchants/normalize';
import { canSplit, categoryKindFor } from '@/domain/transactions/transactions';
import { FormError } from '@/features/auth/components/FormError';
import { CategoryPickerField } from '@/features/categories/components/CategoryPickerField';
import { useCategories, useCategoryName } from '@/features/categories/hooks';
import { useFormatter } from '@/i18n/FormatContext';
import { toAppError } from '@/lib/errors';
import { makeStyles } from '@/theme';
import type { ReceiptFile } from '@/validation/transactions';

import { createTransactionFormSchema, type TransactionFormValues } from '../formSchema';
import { useCategorySuggestion } from '../hooks';
import { AccountPickerField } from './AccountPickerField';
import { DateTimeField } from './DateTimeField';
import { ReceiptField, type ReceiptItem } from './ReceiptField';
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
}

/** Repository field errors → form fields (so e.g. "account archived" shows on the field). */
const FIELD_MAP: Record<string, keyof TransactionFormValues> = {
  accountId: 'accountId',
  categoryId: 'categoryId',
  splits: 'splits',
  amountMinor: 'amount',
  refundOfTransactionId: 'refundOfTransactionId',
};

export function TransactionForm({
  initialValues,
  accounts,
  submitLabel,
  onSubmit,
  receipts,
  onAddReceipt,
  onRemoveReceipt,
}: TransactionFormProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const categoryName = useCategoryName();
  const decimal = formatter.separators.decimal;
  const keySeq = useRef(0);
  const newKey = () => `new-${(keySeq.current += 1)}`;
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [userPickedCategory, setUserPickedCategory] = useState(false);

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

  return (
    <View style={styles.form}>
      <Controller
        control={control}
        name="amount"
        render={({ field, fieldState }) => (
          <TextField
            label={t('transactions.fields.amount')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            keyboardType="decimal-pad"
            placeholder={formatter.amountForInput({ amountMinor: 0, currency })}
            prefix={formatter.currencySymbol(currency)}
            error={errorText(fieldState.error?.message)}
            autoFocus={!initialValues.amount}
          />
        )}
      />

      <Controller
        control={control}
        name="accountId"
        render={({ field, fieldState }) => (
          <AccountPickerField
            label={t('transactions.fields.account')}
            accounts={accounts}
            value={field.value}
            onChange={field.onChange}
            error={errorText(fieldState.error?.message)}
          />
        )}
      />

      <FormTextField
        control={control}
        name="payee"
        label={
          type === 'income' ? t('transactions.fields.source') : t('transactions.fields.merchant')
        }
        placeholder={
          type === 'income'
            ? t('transactions.fields.sourcePlaceholder')
            : t('transactions.fields.merchantPlaceholder')
        }
        autoCapitalize="words"
        maxLength={200}
      />

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
      ) : (
        <Controller
          control={control}
          name="categoryId"
          render={({ field, fieldState }) => (
            <View style={styles.group}>
              <CategoryPickerField
                label={t('transactions.fields.category')}
                kind={kind}
                value={field.value}
                onChange={(id) => {
                  field.onChange(id);
                  setUserPickedCategory(true);
                }}
                error={errorText(fieldState.error?.message)}
              />
              {suggestionSource && selectedCategory ? (
                <Text variant="bodySmall" tone="textSecondary">
                  {suggestionSource === 'rule'
                    ? t('transactions.suggestion.rule')
                    : t('transactions.suggestion.history')}
                </Text>
              ) : null}
            </View>
          )}
        />
      )}

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

      <Controller
        control={control}
        name="localDate"
        render={({ field }) => (
          <Controller
            control={control}
            name="localTime"
            render={({ field: timeField }) => (
              <DateTimeField
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

      {type === 'refund' ? (
        <Controller
          control={control}
          name="refundOfTransactionId"
          render={({ field }) => <RefundLinkField value={field.value} onChange={field.onChange} />}
        />
      ) : null}

      <FormTextField
        control={control}
        name="notes"
        label={t('transactions.fields.notes')}
        multiline
        maxLength={1000}
      />

      <Controller
        control={control}
        name="tagNames"
        render={({ field }) => <TagInput value={field.value} onChange={field.onChange} />}
      />

      <ReceiptField items={receipts} onAdd={onAddReceipt} onRemove={onRemoveReceipt} />

      <FormError error={submitError} />
      <Button label={submitLabel} loading={formState.isSubmitting} onPress={submit} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  form: { gap: t.spacing.lg },
  group: { gap: t.spacing.xs },
}));
