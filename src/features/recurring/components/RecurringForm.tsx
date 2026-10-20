import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormTextField } from '@/components/form/FormTextField';
import { translateMessage } from '@/components/form/translateMessage';
import { Button, Card, ChoiceChips, Icon, SwitchRow, Text, TextField } from '@/components/ui';
import { compareDates } from '@/domain/dates/calendar';
import { RECURRENCE_FREQUENCIES } from '@/domain/enums';
import type { Account } from '@/domain/models';
import {
  previewOccurrences,
  RULE_SCHEDULE_RECURRENCE,
  RULE_SCHEDULES,
} from '@/domain/planning/recurring';
import { occurrencesBetween } from '@/domain/planning/recurrence';
import { FormError } from '@/features/auth/components/FormError';
import { CategoryPickerField } from '@/features/categories/components/CategoryPickerField';
import { AccountPickerField } from '@/features/transactions/components/AccountPickerField';
import { DateTimeField } from '@/features/transactions/components/DateTimeField';
import { TagInput } from '@/features/transactions/components/TagInput';
import { useFormatter } from '@/i18n/FormatContext';
import { toAppError } from '@/lib/errors';
import { makeStyles } from '@/theme';

import {
  createRecurringFormSchema,
  RULE_REMINDER_CHOICES,
  recurrenceOf,
  type RecurringFormValues,
} from '../formSchema';

const FIELD_MAP: Record<string, keyof RecurringFormValues> = {
  accountId: 'accountId',
  categoryId: 'categoryId',
  amountMinor: 'amount',
  interval: 'interval',
  startDate: 'startDate',
  endDate: 'endDate',
  payee: 'payee',
  reminderDaysBefore: 'reminder',
};

export interface RecurringFormProps {
  initialValues: RecurringFormValues;
  accounts: readonly Account[];
  submitLabel: string;
  /** Editing: the type is fixed and history is not affected. */
  isEdit?: boolean;
  onSubmit: (values: RecurringFormValues) => Promise<void>;
}

/** A recurring income or expense, with a preview of the dates it will produce. */
export function RecurringForm({
  initialValues,
  accounts,
  submitLabel,
  isEdit = false,
  onSubmit,
}: RecurringFormProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const decimal = formatter.separators.decimal;
  const today = formatter.today();
  const currencyOf = useMemo(
    () => (id: string) => accounts.find((a) => a.id === id)?.currency ?? null,
    [accounts],
  );
  const schema = useMemo(
    () => createRecurringFormSchema(currencyOf, decimal),
    [currencyOf, decimal],
  );
  const [submitError, setSubmitError] = useState<unknown>(null);
  const { control, handleSubmit, setValue, setError, formState } = useForm<RecurringFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: 'onSubmit',
  });
  const values = useWatch({ control });
  const type = values.type ?? 'expense';
  const currency = currencyOf(values.accountId ?? '') ?? formatter.settings.baseCurrency;

  const recurrence = recurrenceOf({
    schedule: values.schedule ?? 'monthly',
    frequency: values.frequency ?? 'monthly',
    interval: values.interval ?? '1',
  });
  const start = values.startDate ?? today;
  const end = values.hasEnd ? (values.endDate ?? null) : null;
  const preview = useMemo(
    () =>
      previewOccurrences(
        { ...recurrence, startDate: start, endDate: end },
        compareDates(start, today) > 0 ? start : today,
      ),
    [recurrence, start, end, today],
  );
  const pastCount = useMemo(
    () =>
      isEdit || compareDates(start, today) >= 0
        ? 0
        : occurrencesBetween(start, recurrence, start, today, end, 400).filter(
            (d) => compareDates(d, today) < 0,
          ).length,
    [isEdit, start, today, recurrence, end],
  );

  const errorText = (key: string | undefined) => (key ? translateMessage(t, key) : null);

  const submit = handleSubmit(async (v) => {
    setSubmitError(null);
    try {
      await onSubmit(v);
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
      {isEdit ? (
        <View style={styles.notice}>
          <Icon name="information-circle-outline" size={18} tone="textSecondary" />
          <Text variant="bodySmall" tone="textSecondary" style={styles.flex}>
            {t('recurring.editNote')}
          </Text>
        </View>
      ) : null}
      {!isEdit ? (
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <ChoiceChips
              label={t('recurring.fields.type')}
              value={field.value}
              onChange={(next) => {
                field.onChange(next);
                setValue('categoryId', null);
              }}
              choices={(['expense', 'income'] as const).map((value) => ({
                value,
                label: t(`recurring.types.${value}`),
              }))}
            />
          )}
        />
      ) : null}

      <Controller
        control={control}
        name="amount"
        render={({ field, fieldState }) => (
          <TextField
            label={t('recurring.fields.amount')}
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
        name="accountId"
        render={({ field, fieldState }) => (
          <AccountPickerField
            label={t('recurring.fields.account')}
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
            label={t('recurring.fields.category')}
            kind={type}
            value={field.value}
            onChange={field.onChange}
            error={errorText(fieldState.error?.message)}
          />
        )}
      />
      <FormTextField
        control={control}
        name="payee"
        label={t('recurring.fields.payee')}
        autoCapitalize="words"
        maxLength={200}
      />

      <Controller
        control={control}
        name="schedule"
        render={({ field }) => (
          <ChoiceChips
            label={t('recurring.fields.schedule')}
            value={field.value}
            onChange={(next) => {
              field.onChange(next);
              if (next !== 'custom') {
                setValue('frequency', RULE_SCHEDULE_RECURRENCE[next].frequency);
                setValue('interval', String(RULE_SCHEDULE_RECURRENCE[next].interval));
              }
            }}
            choices={[...RULE_SCHEDULES, 'custom' as const].map((value) => ({
              value,
              label: t(`recurring.schedules.${value}`),
            }))}
          />
        )}
      />
      {values.schedule === 'custom' ? (
        <View style={styles.row}>
          <View style={styles.intervalCell}>
            <Controller
              control={control}
              name="interval"
              render={({ field, fieldState }) => (
                <TextField
                  label={t('recurring.fields.interval')}
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
                    label: t(`recurring.units.${value}`),
                  }))}
                />
              )}
            />
          </View>
        </View>
      ) : null}

      <Controller
        control={control}
        name="startDate"
        render={({ field, fieldState }) => (
          <View style={styles.group}>
            <DateTimeField
              label={t('recurring.fields.startDate')}
              date={field.value}
              time="00:00"
              showTime={false}
              onChange={({ date }) => field.onChange(date)}
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
        name="hasEnd"
        render={({ field }) => (
          <SwitchRow
            label={t('recurring.fields.hasEnd')}
            value={field.value}
            onValueChange={(on) => {
              field.onChange(on);
              if (on) setValue('endDate', start);
            }}
          />
        )}
      />
      {values.hasEnd ? (
        <Controller
          control={control}
          name="endDate"
          render={({ field, fieldState }) => (
            <View style={styles.group}>
              <DateTimeField
                label={t('recurring.fields.endDate')}
                date={field.value ?? start}
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

      <Card>
        <View style={styles.group} accessibilityLiveRegion="polite">
          <Text variant="label" tone="textSecondary">
            {t('recurring.preview')}
          </Text>
          {preview.length === 0 ? (
            <Text variant="body">{t('recurring.noMore')}</Text>
          ) : (
            preview.map((d) => (
              <Text key={d} variant="body">
                {formatter.date(d, 'long')}
              </Text>
            ))
          )}
          <Text variant="caption" tone="textSecondary">
            {t('recurring.previewHint')}
          </Text>
          {pastCount > 0 ? (
            <Text variant="caption" tone="warning">
              {t('recurring.pastDue', { count: pastCount })}
            </Text>
          ) : null}
        </View>
      </Card>

      <Controller
        control={control}
        name="autoPost"
        render={({ field }) => (
          <View style={styles.group}>
            <ChoiceChips
              label={t('recurring.fields.posting')}
              value={field.value ? 'auto' : 'confirm'}
              onChange={(next) => field.onChange(next === 'auto')}
              choices={(['confirm', 'auto'] as const).map((value) => ({
                value,
                label: t(`recurring.posting.${value}`),
              }))}
            />
            <Text variant="caption" tone="textSecondary">
              {t(`recurring.postingHint.${field.value ? 'auto' : 'confirm'}`)}
            </Text>
          </View>
        )}
      />
      <Controller
        control={control}
        name="reminder"
        render={({ field }) => (
          <ChoiceChips
            label={t('recurring.fields.reminder')}
            value={field.value}
            onChange={field.onChange}
            choices={[...new Set<string>([...RULE_REMINDER_CHOICES, field.value])].map((value) => ({
              value,
              label:
                value === 'none'
                  ? t('recurring.reminderNone')
                  : value === '0'
                    ? t('recurring.reminderSameDay')
                    : t('recurring.reminderDaysBefore', { count: Number(value) }),
            }))}
          />
        )}
      />
      <Controller
        control={control}
        name="tagNames"
        render={({ field }) => (
          <View style={styles.group}>
            <Text variant="label" tone="textSecondary">
              {t('recurring.fields.tags')}
            </Text>
            <TagInput value={field.value} onChange={field.onChange} />
          </View>
        )}
      />
      <FormTextField
        control={control}
        name="notes"
        label={t('recurring.fields.notes')}
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
