import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormTextField } from '@/components/form/FormTextField';
import { translateMessage } from '@/components/form/translateMessage';
import {
  Button,
  ChoiceChips,
  Icon,
  OptionPicker,
  type PickerOption,
  SwitchRow,
  Text,
  TextField,
} from '@/components/ui';
import { RECURRENCE_FREQUENCIES } from '@/domain/enums';
import type { Account } from '@/domain/models';
import { PRESET_RECURRENCE, RECURRENCE_PRESETS } from '@/domain/planning/recurrence';
import { FormError } from '@/features/auth/components/FormError';
import { CategoryPickerField } from '@/features/categories/components/CategoryPickerField';
import { useCurrencyOptions } from '@/features/regional/options';
import { DateTimeField } from '@/features/transactions/components/DateTimeField';
import { useFormatter } from '@/i18n/FormatContext';
import { toAppError } from '@/lib/errors';
import { makeStyles } from '@/theme';

import { type BillFormValues, createBillFormSchema, REMINDER_CHOICES } from '../formSchema';

const NO_ACCOUNT = '__none__';

export interface BillFormProps {
  initialValues: BillFormValues;
  accounts: readonly Account[];
  submitLabel: string;
  onSubmit: (values: BillFormValues) => Promise<void>;
}

const FIELD_MAP: Record<string, keyof BillFormValues> = {
  accountId: 'accountId',
  categoryId: 'categoryId',
  currency: 'currency',
  amountMinor: 'amount',
  interval: 'interval',
  nextDueDate: 'nextDueDate',
  endDate: 'endDate',
  name: 'name',
};

/** Bill or subscription: an expected, recurring payment (never a transaction itself). */
export function BillForm({ initialValues, accounts, submitLabel, onSubmit }: BillFormProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const decimal = formatter.separators.decimal;
  const schema = useMemo(() => createBillFormSchema(decimal), [decimal]);
  const currencyOptions = useCurrencyOptions(formatter.numberLocale);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const { control, handleSubmit, setValue, setError, formState } = useForm<BillFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: 'onSubmit',
  });
  const [isSubscription, accountId, currency, preset, hasEnd, nextDueDate, reminder] = useWatch({
    control,
    name: [
      'isSubscription',
      'accountId',
      'currency',
      'preset',
      'hasEnd',
      'nextDueDate',
      'reminder',
    ],
  });

  const accountOptions = useMemo<PickerOption<string>[]>(
    () => [
      { value: NO_ACCOUNT, label: t('bills.fields.noAccount') },
      ...accounts
        .filter((a) => !a.isArchived || a.id === initialValues.accountId)
        .map((a) => ({
          value: a.id,
          label: a.name,
          description: a.isArchived ? `${a.currency} · ${t('accounts.archivedBadge')}` : a.currency,
          disabled: a.isArchived,
        })),
    ],
    [accounts, initialValues.accountId, t],
  );
  const accountCurrency = accounts.find((a) => a.id === accountId)?.currency ?? null;

  const reminderChoices = useMemo(() => {
    const values: string[] = [...REMINDER_CHOICES];
    if (!values.includes(reminder)) values.push(reminder);
    return values.map((value) => ({
      value,
      label:
        value === 'none'
          ? t('bills.reminders.none')
          : value === '0'
            ? t('bills.reminders.sameDay')
            : t('bills.reminders.daysBefore', { count: Number(value) }),
    }));
  }, [reminder, t]);

  const errorText = (key: string | undefined) => (key ? translateMessage(t, key) : null);

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
      <FormTextField
        control={control}
        name="name"
        label={isSubscription ? t('bills.fields.serviceName') : t('bills.fields.name')}
        autoCapitalize="words"
        maxLength={100}
      />

      <Controller
        control={control}
        name="amount"
        render={({ field, fieldState }) => (
          <TextField
            label={t('bills.fields.amount')}
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
        name="isVariableAmount"
        render={({ field }) => (
          <SwitchRow
            label={t('bills.fields.variable')}
            hint={t('bills.fields.variableHint')}
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name="accountId"
        render={({ field, fieldState }) => (
          <View style={styles.group}>
            <OptionPicker
              label={t('bills.fields.account')}
              value={field.value ?? NO_ACCOUNT}
              options={accountOptions}
              onChange={(next) => {
                const id = next === NO_ACCOUNT ? null : next;
                field.onChange(id);
                const account = accounts.find((a) => a.id === id);
                if (account) setValue('currency', account.currency);
              }}
            />
            {fieldState.error?.message ? (
              <Text variant="bodySmall" tone="negative">
                {errorText(fieldState.error.message)}
              </Text>
            ) : null}
          </View>
        )}
      />

      <Controller
        control={control}
        name="currency"
        render={({ field, fieldState }) => (
          <View style={styles.group}>
            <OptionPicker
              label={t('bills.fields.currency')}
              value={field.value}
              options={currencyOptions}
              onChange={field.onChange}
              searchable
              disabled={accountCurrency !== null}
            />
            {fieldState.error?.message ? (
              <Text variant="bodySmall" tone="negative">
                {errorText(fieldState.error.message)}
              </Text>
            ) : null}
          </View>
        )}
      />

      <Controller
        control={control}
        name="categoryId"
        render={({ field, fieldState }) => (
          <CategoryPickerField
            label={t('bills.fields.category')}
            kind="expense"
            value={field.value}
            onChange={field.onChange}
            error={errorText(fieldState.error?.message)}
          />
        )}
      />

      <Controller
        control={control}
        name="preset"
        render={({ field }) => (
          <ChoiceChips
            label={t('bills.fields.frequency')}
            value={field.value}
            onChange={(next) => {
              field.onChange(next);
              if (next !== 'custom') {
                setValue('frequency', PRESET_RECURRENCE[next].frequency);
                setValue('interval', String(PRESET_RECURRENCE[next].interval));
              }
            }}
            choices={[...RECURRENCE_PRESETS, 'custom' as const].map((value) => ({
              value,
              label: t(`bills.presets.${value}`),
            }))}
          />
        )}
      />
      {preset === 'custom' ? (
        <View style={styles.row}>
          <View style={styles.intervalCell}>
            <Controller
              control={control}
              name="interval"
              render={({ field, fieldState }) => (
                <TextField
                  label={t('bills.fields.every')}
                  value={field.value}
                  onChangeText={field.onChange}
                  keyboardType="number-pad"
                  maxLength={3}
                  error={errorText(fieldState.error?.message)}
                />
              )}
            />
          </View>
          <View style={styles.flex}>
            <Controller
              control={control}
              name="frequency"
              render={({ field }) => (
                <ChoiceChips
                  label={t('bills.fields.unit')}
                  value={field.value}
                  onChange={field.onChange}
                  choices={RECURRENCE_FREQUENCIES.map((value) => ({
                    value,
                    label: t(`bills.units.${value}`),
                  }))}
                />
              )}
            />
          </View>
        </View>
      ) : null}

      <Controller
        control={control}
        name="nextDueDate"
        render={({ field }) => (
          <View style={styles.group}>
            <DateTimeField
              label={isSubscription ? t('bills.fields.nextBilling') : t('bills.fields.nextDue')}
              date={field.value}
              time="00:00"
              showTime={false}
              onChange={({ date }) => field.onChange(date)}
            />
            {Number(field.value.slice(8, 10)) > 28 ? (
              <Text variant="bodySmall" tone="textSecondary">
                {t('bills.monthEndNote')}
              </Text>
            ) : null}
          </View>
        )}
      />

      <Controller
        control={control}
        name="hasEnd"
        render={({ field }) => (
          <SwitchRow
            label={t('bills.fields.hasEnd')}
            value={field.value}
            onValueChange={(on) => {
              field.onChange(on);
              if (on) setValue('endDate', nextDueDate);
            }}
          />
        )}
      />
      {hasEnd ? (
        <Controller
          control={control}
          name="endDate"
          render={({ field, fieldState }) => (
            <View style={styles.group}>
              <DateTimeField
                label={t('bills.fields.endDate')}
                date={field.value ?? nextDueDate}
                time="00:00"
                showTime={false}
                onChange={({ date }) => field.onChange(date)}
              />
              {fieldState.error?.message ? (
                <Text variant="bodySmall" tone="negative" accessibilityLiveRegion="polite">
                  {errorText(fieldState.error.message)}
                </Text>
              ) : null}
            </View>
          )}
        />
      ) : null}

      <Controller
        control={control}
        name="reminder"
        render={({ field }) => (
          <View style={styles.group}>
            <ChoiceChips
              label={t('bills.fields.reminder')}
              value={field.value}
              onChange={field.onChange}
              choices={reminderChoices}
            />
            <View style={styles.notice}>
              <Icon name="notifications-off-outline" size={16} tone="textSecondary" />
              <Text variant="caption" tone="textSecondary" style={styles.flex}>
                {t('bills.reminders.notice')}
              </Text>
            </View>
          </View>
        )}
      />

      <Controller
        control={control}
        name="autopay"
        render={({ field }) => (
          <SwitchRow
            label={t('bills.fields.autopay')}
            hint={t('bills.fields.autopayHint')}
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />

      <FormTextField
        control={control}
        name="notes"
        label={t('bills.fields.notes')}
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
  group: { gap: t.spacing.xs },
  row: { flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start', flexWrap: 'wrap' },
  intervalCell: { width: 96 },
  flex: { flex: 1 },
  notice: { flexDirection: 'row', gap: t.spacing.xs, alignItems: 'flex-start' },
}));
