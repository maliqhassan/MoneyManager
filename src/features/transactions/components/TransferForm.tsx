import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormTextField } from '@/components/form/FormTextField';
import { translateMessage } from '@/components/form/translateMessage';
import { Button, TextField } from '@/components/ui';
import type { Account } from '@/domain/models';
import { FormError } from '@/features/auth/components/FormError';
import { useFormatter } from '@/i18n/FormatContext';
import { toAppError } from '@/lib/errors';
import { makeStyles } from '@/theme';

import { createTransferFormSchema, type TransferFormValues } from '../formSchema';
import { AccountPickerField } from './AccountPickerField';
import { DateTimeField } from './DateTimeField';

const FIELD_MAP: Record<string, keyof TransferFormValues> = {
  fromAccountId: 'fromAccountId',
  toAccountId: 'toAccountId',
  receivedAmountMinor: 'received',
  amountMinor: 'amount',
};

/**
 * Transfer between two of the user's accounts (including credit-card
 * payments). Never income or expense. Cross-currency transfers ask for the
 * amount that actually arrived.
 */
export function TransferForm({
  initialValues,
  accounts,
  submitLabel,
  onSubmit,
}: {
  initialValues: TransferFormValues;
  accounts: readonly Account[];
  submitLabel: string;
  onSubmit: (values: TransferFormValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const currencyOf = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.id, a.currency]));
    return (id: string) => map.get(id) ?? null;
  }, [accounts]);
  const schema = useMemo(
    () => createTransferFormSchema({ decimal: formatter.separators.decimal, currencyOf }),
    [formatter.separators.decimal, currencyOf],
  );
  const { control, handleSubmit, setError, formState } = useForm<TransferFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });
  const [fromId, toId] = useWatch({ control, name: ['fromAccountId', 'toAccountId'] });
  const fromCurrency = currencyOf(fromId) ?? formatter.settings.baseCurrency;
  const toCurrency = currencyOf(toId);
  const crossCurrency = !!toCurrency && toCurrency !== fromCurrency;
  const err = (key: string | undefined) => (key ? translateMessage(t, key) : null);

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      let mapped = false;
      for (const [field, key] of Object.entries(toAppError(error).fieldErrors ?? {})) {
        const target = FIELD_MAP[field];
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
            prefix={formatter.currencySymbol(fromCurrency)}
            error={err(fieldState.error?.message)}
            autoFocus={!initialValues.amount}
          />
        )}
      />
      <Controller
        control={control}
        name="fromAccountId"
        render={({ field, fieldState }) => (
          <AccountPickerField
            label={t('transactions.fields.fromAccount')}
            accounts={accounts}
            value={field.value}
            onChange={field.onChange}
            error={err(fieldState.error?.message)}
          />
        )}
      />
      <Controller
        control={control}
        name="toAccountId"
        render={({ field, fieldState }) => (
          <AccountPickerField
            label={t('transactions.fields.toAccount')}
            accounts={accounts}
            value={field.value}
            onChange={field.onChange}
            excludeId={fromId}
            error={err(fieldState.error?.message)}
          />
        )}
      />
      {crossCurrency ? (
        <Controller
          control={control}
          name="received"
          render={({ field, fieldState }) => (
            <TextField
              label={t('transactions.fields.received')}
              hint={t('transactions.fields.receivedHint')}
              value={field.value}
              onChangeText={field.onChange}
              keyboardType="decimal-pad"
              prefix={formatter.currencySymbol(toCurrency)}
              error={err(fieldState.error?.message)}
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
      <FormTextField
        control={control}
        name="notes"
        label={t('transactions.fields.notes')}
        multiline
        maxLength={1000}
      />
      <FormError error={submitError} />
      <Button label={submitLabel} loading={formState.isSubmitting} onPress={submit} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  form: { gap: t.spacing.lg },
}));
