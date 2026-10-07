import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { z } from 'zod';

import { FormTextField } from '@/components/form/FormTextField';
import { translateMessage } from '@/components/form/translateMessage';
import { Button, ChoiceChips, OptionPicker, Text, TextField } from '@/components/ui';
import type { Account } from '@/domain/models';
import { FormError } from '@/features/auth/components/FormError';
import { CategoryPickerField } from '@/features/categories/components/CategoryPickerField';
import { AccountPickerField } from '@/features/transactions/components/AccountPickerField';
import { DateTimeField } from '@/features/transactions/components/DateTimeField';
import { parsePositiveAmount } from '@/features/transactions/formSchema';
import { useFormatter } from '@/i18n/FormatContext';
import { toAppError } from '@/lib/errors';
import type { TransactionListItem } from '@/repositories/types';
import { makeStyles } from '@/theme';

export interface PayBillFormValues {
  mode: 'new' | 'link';
  amount: string;
  accountId: string;
  categoryId: string | null;
  localDate: string;
  localTime: string;
  notes: string;
  transactionId: string | null;
}

function createPayBillSchema(
  decimal: string,
  currencyOf: (id: string) => Account['currency'] | null,
) {
  return z
    .object({
      mode: z.enum(['new', 'link']),
      amount: z.string(),
      accountId: z.string(),
      categoryId: z.string().nullable(),
      localDate: z.string(),
      localTime: z.string(),
      notes: z.string().max(1000, { message: 'validation.tooLong' }),
      transactionId: z.string().nullable(),
    })
    .superRefine((v, ctx) => {
      if (v.mode === 'link') {
        if (!v.transactionId) {
          ctx.addIssue({ code: 'custom', path: ['transactionId'], message: 'validation.required' });
        }
        return;
      }
      const currency = currencyOf(v.accountId);
      if (!currency) {
        ctx.addIssue({ code: 'custom', path: ['accountId'], message: 'validation.required' });
      } else {
        const amount = parsePositiveAmount(v.amount, currency, decimal);
        if (!amount.ok) ctx.addIssue({ code: 'custom', path: ['amount'], message: amount.error });
      }
      if (!v.categoryId) {
        ctx.addIssue({
          code: 'custom',
          path: ['categoryId'],
          message: 'transactions.errors.categoryRequired',
        });
      }
    });
}

const FIELD_MAP: Record<string, keyof PayBillFormValues> = {
  accountId: 'accountId',
  categoryId: 'categoryId',
  amountMinor: 'amount',
  transactionId: 'transactionId',
};

/**
 * Confirms a bill payment: amount, account, date and category become a
 * normal expense transaction — or the payment is linked to one that was
 * already recorded. Either way the bill itself never moves money.
 */
export function PayBillForm({
  initialValues,
  accounts,
  candidates,
  onSubmit,
}: {
  initialValues: PayBillFormValues;
  accounts: readonly Account[];
  candidates: readonly TransactionListItem[];
  onSubmit: (values: PayBillFormValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const decimal = formatter.separators.decimal;
  const currencyOf = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.id, a.currency]));
    return (id: string) => map.get(id) ?? null;
  }, [accounts]);
  const schema = useMemo(() => createPayBillSchema(decimal, currencyOf), [decimal, currencyOf]);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const { control, handleSubmit, setError, formState } = useForm<PayBillFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: 'onSubmit',
  });
  const [mode, accountId] = useWatch({ control, name: ['mode', 'accountId'] });
  const currency = currencyOf(accountId) ?? formatter.settings.baseCurrency;

  const linkOptions = useMemo(
    () =>
      candidates.map((c) => ({
        value: c.id,
        label: c.payee ?? c.categoryName ?? c.accountName,
        description: `${formatter.date(c.localDate, 'medium')} · ${formatter.money({
          amountMinor: Math.abs(c.amountMinor),
          currency: c.currency,
        })} · ${c.accountName}`,
      })),
    [candidates, formatter],
  );

  const errorText = (key: string | undefined) => (key ? translateMessage(t, key) : null);

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      let mapped = false;
      for (const [field, key] of Object.entries(toAppError(error).fieldErrors ?? {})) {
        const target = FIELD_MAP[field.replace(/^transaction\./, '')];
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
        name="mode"
        render={({ field }) => (
          <ChoiceChips
            value={field.value}
            onChange={field.onChange}
            choices={[
              { value: 'new', label: t('bills.pay.modeNew'), icon: 'add-circle-outline' },
              { value: 'link', label: t('bills.pay.modeLink'), icon: 'link-outline' },
            ]}
          />
        )}
      />

      {mode === 'link' ? (
        candidates.length === 0 ? (
          <Text variant="body" tone="textSecondary">
            {t('bills.pay.noCandidates')}
          </Text>
        ) : (
          <Controller
            control={control}
            name="transactionId"
            render={({ field, fieldState }) => (
              <View style={styles.group}>
                <Text variant="bodySmall" tone="textSecondary">
                  {t('bills.pay.linkHint')}
                </Text>
                <OptionPicker
                  label={t('bills.pay.linkPick')}
                  value={field.value}
                  options={linkOptions}
                  onChange={field.onChange}
                  searchable
                />
                {fieldState.error?.message ? (
                  <Text variant="bodySmall" tone="negative">
                    {errorText(fieldState.error.message)}
                  </Text>
                ) : null}
              </View>
            )}
          />
        )
      ) : (
        <>
          <Text variant="bodySmall" tone="textSecondary">
            {t('bills.pay.intro')}
          </Text>
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
                prefix={formatter.currencySymbol(currency)}
                error={errorText(fieldState.error?.message)}
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
          <Controller
            control={control}
            name="categoryId"
            render={({ field, fieldState }) => (
              <CategoryPickerField
                label={t('transactions.fields.category')}
                kind="expense"
                value={field.value}
                onChange={field.onChange}
                error={errorText(fieldState.error?.message)}
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
          <FormTextField
            control={control}
            name="notes"
            label={t('transactions.fields.notes')}
            multiline
            maxLength={1000}
          />
        </>
      )}

      <FormError error={submitError} />
      <Button
        label={mode === 'link' ? t('bills.pay.linkSubmit') : t('bills.pay.submit')}
        loading={formState.isSubmitting}
        disabled={mode === 'link' && candidates.length === 0}
        onPress={submit}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  form: { gap: t.spacing.lg },
  group: { gap: t.spacing.xs },
}));
