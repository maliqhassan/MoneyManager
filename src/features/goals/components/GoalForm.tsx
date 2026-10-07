import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormTextField } from '@/components/form/FormTextField';
import { translateMessage } from '@/components/form/translateMessage';
import {
  Button,
  OptionPicker,
  type PickerOption,
  SwitchRow,
  Text,
  TextField,
} from '@/components/ui';
import type { Account } from '@/domain/models';
import {
  AccountColorPicker,
  AccountIconPicker,
} from '@/features/accounts/components/AppearancePickers';
import { FormError } from '@/features/auth/components/FormError';
import { useCurrencyOptions } from '@/features/regional/options';
import { DateTimeField } from '@/features/transactions/components/DateTimeField';
import { useFormatter } from '@/i18n/FormatContext';
import { toAppError } from '@/lib/errors';
import { makeStyles } from '@/theme';

import { createGoalFormSchema, type GoalFormValues } from '../formSchema';

const NO_ACCOUNT = '__none__';

export interface GoalFormProps {
  initialValues: GoalFormValues;
  accounts: readonly Account[];
  submitLabel: string;
  onSubmit: (values: GoalFormValues) => Promise<void>;
  /** Contributions exist, so the currency is fixed. */
  currencyLocked?: boolean;
}

export function GoalForm({
  initialValues,
  accounts,
  submitLabel,
  onSubmit,
  currencyLocked = false,
}: GoalFormProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const decimal = formatter.separators.decimal;
  const schema = useMemo(() => createGoalFormSchema(decimal), [decimal]);
  const currencyOptions = useCurrencyOptions(formatter.numberLocale);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const { control, handleSubmit, setError, formState } = useForm<GoalFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: 'onSubmit',
  });
  const [currency, hasTargetDate, color] = useWatch({
    control,
    name: ['currency', 'hasTargetDate', 'color'],
  });

  const accountOptions = useMemo<PickerOption<string>[]>(
    () => [
      { value: NO_ACCOUNT, label: t('goals.fields.noAccount') },
      ...accounts
        .filter((a) => !a.isArchived || a.id === initialValues.accountId)
        .map((a) => ({
          value: a.id,
          label: a.name,
          description: a.currency,
          disabled: a.isArchived,
        })),
    ],
    [accounts, initialValues.accountId, t],
  );

  const errorText = (key: string | undefined) => (key ? translateMessage(t, key) : null);

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      const fields = toAppError(error).fieldErrors ?? {};
      let mapped = false;
      for (const [field, key] of Object.entries(fields)) {
        const target = field === 'targetAmountMinor' ? 'target' : field;
        if (
          target === 'target' ||
          target === 'currency' ||
          target === 'accountId' ||
          target === 'name'
        ) {
          setError(target, { message: key });
          mapped = true;
        }
      }
      if (!mapped) setSubmitError(error);
    }
  });

  return (
    <View style={styles.form}>
      <FormTextField
        control={control}
        name="name"
        label={t('goals.fields.name')}
        autoCapitalize="sentences"
        maxLength={100}
      />
      <Controller
        control={control}
        name="target"
        render={({ field, fieldState }) => (
          <TextField
            label={t('goals.fields.target')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            keyboardType="decimal-pad"
            placeholder={formatter.amountForInput({ amountMinor: 0, currency })}
            prefix={formatter.currencySymbol(currency)}
            error={errorText(fieldState.error?.message)}
          />
        )}
      />
      <Controller
        control={control}
        name="currency"
        render={({ field, fieldState }) => (
          <View style={styles.group}>
            <OptionPicker
              label={t('goals.fields.currency')}
              value={field.value}
              options={currencyOptions}
              onChange={field.onChange}
              searchable
              disabled={currencyLocked}
              hint={currencyLocked ? t('goals.errors.currencyLocked') : undefined}
            />
            {fieldState.error?.message ? (
              <TextFieldError text={errorText(fieldState.error.message)} />
            ) : null}
          </View>
        )}
      />
      <Controller
        control={control}
        name="hasTargetDate"
        render={({ field }) => (
          <SwitchRow
            label={t('goals.fields.hasTargetDate')}
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />
      {hasTargetDate ? (
        <Controller
          control={control}
          name="targetDate"
          render={({ field }) => (
            <DateTimeField
              label={t('goals.fields.targetDate')}
              date={field.value}
              time="00:00"
              showTime={false}
              onChange={({ date }) => field.onChange(date)}
            />
          )}
        />
      ) : null}
      <Controller
        control={control}
        name="accountId"
        render={({ field, fieldState }) => (
          <View style={styles.group}>
            <OptionPicker
              label={t('goals.fields.account')}
              value={field.value ?? NO_ACCOUNT}
              options={accountOptions}
              onChange={(next) => field.onChange(next === NO_ACCOUNT ? null : next)}
            />
            {fieldState.error?.message ? (
              <TextFieldError text={errorText(fieldState.error.message)} />
            ) : null}
          </View>
        )}
      />
      <Controller
        control={control}
        name="icon"
        render={({ field }) => (
          <AccountIconPicker value={field.value} color={color} onChange={field.onChange} />
        )}
      />
      <Controller
        control={control}
        name="color"
        render={({ field }) => <AccountColorPicker value={field.value} onChange={field.onChange} />}
      />
      <FormError error={submitError} />
      <Button label={submitLabel} loading={formState.isSubmitting} onPress={submit} />
    </View>
  );
}

function TextFieldError({ text }: { text: string | null }) {
  return text ? (
    <Text variant="bodySmall" tone="negative" accessibilityLiveRegion="polite">
      {text}
    </Text>
  ) : null;
}

const useStyles = makeStyles((t) => ({
  form: { gap: t.spacing.lg },
  group: { gap: t.spacing.xs },
}));
