import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { translateMessage } from '@/components/form/translateMessage';
import {
  Button,
  ChoiceChips,
  Icon,
  OptionPicker,
  SwitchRow,
  Text,
  TextField,
} from '@/components/ui';
import { BUDGET_PERIOD_TYPES } from '@/domain/enums';
import { FormError } from '@/features/auth/components/FormError';
import { CategoryPickerField } from '@/features/categories/components/CategoryPickerField';
import { useCategories, useCategoryName } from '@/features/categories/hooks';
import { useCurrencyOptions, useWeekdayChoices } from '@/features/regional/options';
import { DateTimeField } from '@/features/transactions/components/DateTimeField';
import { useFormatter } from '@/i18n/FormatContext';
import { toAppError } from '@/lib/errors';
import { makeStyles } from '@/theme';

import { type BudgetFormValues, createBudgetFormSchema } from '../formSchema';

export interface BudgetFormProps {
  initialValues: BudgetFormValues;
  submitLabel: string;
  onSubmit: (values: BudgetFormValues) => Promise<void>;
  /** Periods have completed: scope, period, currency and dates are fixed. */
  historyLocked?: boolean;
}

const FIELDS = new Set<keyof BudgetFormValues>([
  'categoryId',
  'name',
  'currency',
  'periodType',
  'startDate',
  'endDate',
]);

export function BudgetForm({
  initialValues,
  submitLabel,
  onSubmit,
  historyLocked = false,
}: BudgetFormProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const categoryName = useCategoryName();
  const decimal = formatter.separators.decimal;
  const schema = useMemo(() => createBudgetFormSchema(decimal), [decimal]);
  const currencyOptions = useCurrencyOptions(formatter.numberLocale);
  const weekdays = useWeekdayChoices();
  const categories = useCategories({ kind: 'expense', includeArchived: true });
  const [nameEdited, setNameEdited] = useState(initialValues.name.trim().length > 0);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const { control, handleSubmit, setValue, setError, formState } = useForm<BudgetFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: 'onSubmit',
  });
  const [scope, periodType, currency] = useWatch({
    control,
    name: ['scope', 'periodType', 'currency'],
  });

  // The name follows the chosen scope until the user types their own.
  const suggestName = (nextScope: 'overall' | 'category', categoryId: string | null) => {
    if (nameEdited) return;
    const category = categories.data?.find((c) => c.id === categoryId);
    const suggested =
      nextScope === 'overall' ? t('budgets.overall') : category ? categoryName(category) : '';
    setValue('name', suggested);
  };

  const errorText = (key: string | undefined) => (key ? translateMessage(t, key) : null);
  const weekdayName =
    weekdays.find((w) => w.value === String(formatter.settings.firstDayOfWeek))?.label ?? '';

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      let mapped = false;
      for (const [field, key] of Object.entries(toAppError(error).fieldErrors ?? {})) {
        const target = (field === 'amountMinor' ? 'amount' : field) as keyof BudgetFormValues;
        if (target === 'amount' || FIELDS.has(target)) {
          setError(target, { message: key });
          mapped = true;
        }
      }
      if (!mapped) setSubmitError(error);
    }
  });

  return (
    <View style={styles.form}>
      {historyLocked ? (
        <View style={styles.notice}>
          <Icon name="lock-closed-outline" size={18} tone="textSecondary" />
          <Text variant="bodySmall" tone="textSecondary" style={styles.flex}>
            {t('budgets.historyLocked')}
          </Text>
        </View>
      ) : null}

      <Controller
        control={control}
        name="scope"
        render={({ field }) => (
          <ChoiceChips
            label={t('budgets.fields.scope')}
            value={field.value}
            disabled={historyLocked}
            onChange={(next) => {
              field.onChange(next);
              suggestName(next, null);
              if (next === 'overall') setValue('categoryId', null);
            }}
            choices={[
              { value: 'overall', label: t('budgets.scopeOverall'), icon: 'pie-chart-outline' },
              { value: 'category', label: t('budgets.scopeCategory'), icon: 'pricetag-outline' },
            ]}
          />
        )}
      />

      {scope === 'category' ? (
        <Controller
          control={control}
          name="categoryId"
          render={({ field, fieldState }) => (
            <CategoryPickerField
              label={t('budgets.fields.category')}
              kind="expense"
              value={field.value}
              disabled={historyLocked}
              onChange={(id) => {
                field.onChange(id);
                suggestName('category', id);
              }}
              error={errorText(fieldState.error?.message)}
            />
          )}
        />
      ) : (
        <Text variant="bodySmall" tone="textSecondary">
          {t('budgets.overallHint')}
        </Text>
      )}

      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField
            label={t('budgets.fields.name')}
            value={field.value}
            onChangeText={(text) => {
              setNameEdited(true);
              field.onChange(text);
            }}
            onBlur={field.onBlur}
            maxLength={100}
            error={errorText(fieldState.error?.message)}
          />
        )}
      />

      <Controller
        control={control}
        name="periodType"
        render={({ field }) => (
          <ChoiceChips
            label={t('budgets.fields.period')}
            value={field.value}
            disabled={historyLocked}
            onChange={field.onChange}
            choices={BUDGET_PERIOD_TYPES.map((value) => ({
              value,
              label: t(`budgets.periodTypes.${value}`),
            }))}
          />
        )}
      />

      <Controller
        control={control}
        name="amount"
        render={({ field, fieldState }) => (
          <TextField
            label={t('budgets.fields.amount')}
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
        render={({ field }) => (
          <OptionPicker
            label={t('budgets.fields.currency')}
            value={field.value}
            options={currencyOptions}
            onChange={field.onChange}
            searchable
            disabled={historyLocked}
          />
        )}
      />

      <Controller
        control={control}
        name="startDate"
        render={({ field, fieldState }) => (
          <View style={styles.group}>
            <DateTimeField
              label={t('budgets.fields.startDate')}
              date={field.value}
              time="00:00"
              showTime={false}
              disabled={historyLocked}
              onChange={({ date }) => field.onChange(date)}
            />
            {periodType !== 'custom' ? (
              <Text variant="bodySmall" tone="textSecondary">
                {periodType === 'weekly'
                  ? t('budgets.startHint.weekly', { weekday: weekdayName })
                  : t('budgets.startHint.monthly')}
              </Text>
            ) : null}
            {fieldState.error?.message ? (
              <Text variant="bodySmall" tone="negative">
                {errorText(fieldState.error.message)}
              </Text>
            ) : null}
          </View>
        )}
      />

      {periodType === 'custom' ? (
        <Controller
          control={control}
          name="endDate"
          render={({ field, fieldState }) => (
            <View style={styles.group}>
              <DateTimeField
                label={t('budgets.fields.endDate')}
                date={field.value ?? initialValues.startDate}
                time="00:00"
                showTime={false}
                disabled={historyLocked}
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
      ) : (
        <Controller
          control={control}
          name="rolloverEnabled"
          render={({ field }) => (
            <SwitchRow
              label={t('budgets.fields.rollover')}
              hint={t('budgets.fields.rolloverHint')}
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />
      )}

      <FormError error={submitError} />
      <Button label={submitLabel} loading={formState.isSubmitting} onPress={submit} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  form: { gap: t.spacing.lg },
  group: { gap: t.spacing.xs },
  notice: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
  },
  flex: { flex: 1 },
}));
