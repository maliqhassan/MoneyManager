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
  Text,
  TextField,
} from '@/components/ui';
import type { Account } from '@/domain/models';
import { FormError } from '@/features/auth/components/FormError';
import { useCurrencyOptions } from '@/features/regional/options';
import { AccountPickerField } from '@/features/transactions/components/AccountPickerField';
import { DateTimeField } from '@/features/transactions/components/DateTimeField';
import { useFormatter } from '@/i18n/FormatContext';
import { toAppError } from '@/lib/errors';
import type { TransferCandidate } from '@/repositories/types';
import { makeStyles } from '@/theme';

import { type ContributionFormValues, createContributionFormSchema } from '../formSchema';

const NONE = '__none__';

export interface ContributionFormProps {
  initialValues: ContributionFormValues;
  accounts: readonly Account[];
  transferCandidates: readonly TransferCandidate[];
  submitLabel: string;
  onSubmit: (values: ContributionFormValues) => Promise<void>;
  /** Recording a new transfer is only offered when adding. */
  allowNewTransfer: boolean;
}

const FIELD_MAP: Record<string, keyof ContributionFormValues> = {
  amountMinor: 'amount',
  accountId: 'accountId',
  transferId: 'transferId',
  newTransfer: 'fromAccountId',
  fromAccountId: 'fromAccountId',
  toAccountId: 'toAccountId',
  currency: 'currency',
};

/**
 * Money set aside for a goal. Optionally records (or links) the transfer
 * that actually moved it — the transfer changes balances, the contribution
 * changes goal progress; neither counts as spending.
 */
export function ContributionForm({
  initialValues,
  accounts,
  transferCandidates,
  submitLabel,
  onSubmit,
  allowNewTransfer,
}: ContributionFormProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const decimal = formatter.separators.decimal;
  const schema = useMemo(() => createContributionFormSchema(decimal), [decimal]);
  const currencyOptions = useCurrencyOptions(formatter.numberLocale);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const { control, handleSubmit, setError, setValue, formState } = useForm<ContributionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: 'onSubmit',
  });
  const [currency, transferMode, transferId] = useWatch({
    control,
    name: ['currency', 'transferMode', 'transferId'],
  });

  const active = accounts.filter((a) => !a.isArchived);
  const accountOptions = useMemo<PickerOption<string>[]>(
    () => [
      { value: NONE, label: t('goals.fields.noAccount') },
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
  const candidates = useMemo(() => {
    return transferCandidates.map((c) => ({
      value: c.id,
      label: `${c.fromAccountName} → ${c.toAccountName}`,
      description: `${formatter.date(c.localDate, 'medium')} · ${formatter.money({
        amountMinor: c.amountMinor,
        currency: c.currency,
      })}`,
    }));
  }, [transferCandidates, formatter]);

  const modes = [
    { value: 'none' as const, label: t('goals.contribution.linkNone') },
    ...(allowNewTransfer
      ? [{ value: 'new' as const, label: t('goals.contribution.moveMoney') }]
      : []),
    ...(candidates.length > 0 || transferId
      ? [{ value: 'link' as const, label: t('goals.contribution.link') }]
      : []),
  ];

  const errorText = (key: string | undefined) => (key ? translateMessage(t, key) : null);

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      let mapped = false;
      for (const [field, key] of Object.entries(toAppError(error).fieldErrors ?? {})) {
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
      <View style={styles.notice}>
        <Icon name="information-circle-outline" size={18} tone="textSecondary" />
        <Text variant="bodySmall" tone="textSecondary" style={styles.flex}>
          {t('goals.model')}
        </Text>
      </View>

      <Controller
        control={control}
        name="amount"
        render={({ field, fieldState }) => (
          <TextField
            label={t('goals.contribution.amount')}
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
        name="currency"
        render={({ field, fieldState }) => (
          <View style={styles.group}>
            <OptionPicker
              label={t('goals.contribution.currency')}
              value={field.value}
              options={currencyOptions}
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
      <Controller
        control={control}
        name="contributedOn"
        render={({ field }) => (
          <DateTimeField
            label={t('goals.contribution.date')}
            date={field.value}
            time="00:00"
            showTime={false}
            onChange={({ date }) => field.onChange(date)}
          />
        )}
      />

      <Controller
        control={control}
        name="transferMode"
        render={({ field }) => (
          <View style={styles.group}>
            <ChoiceChips value={field.value} onChange={field.onChange} choices={modes} />
            <Text variant="bodySmall" tone="textSecondary">
              {field.value === 'new'
                ? t('goals.contribution.moveMoneyHint')
                : field.value === 'link'
                  ? t('goals.contribution.linkHint')
                  : ''}
            </Text>
          </View>
        )}
      />

      {transferMode === 'new' ? (
        <>
          <Controller
            control={control}
            name="fromAccountId"
            render={({ field, fieldState }) => (
              <AccountPickerField
                label={t('goals.contribution.from')}
                accounts={active}
                value={field.value}
                onChange={(id) => {
                  field.onChange(id);
                  const account = accounts.find((a) => a.id === id);
                  if (account) setValue('currency', account.currency);
                }}
                error={errorText(fieldState.error?.message)}
              />
            )}
          />
          <Controller
            control={control}
            name="toAccountId"
            render={({ field, fieldState }) => (
              <AccountPickerField
                label={t('goals.contribution.to')}
                accounts={active}
                value={field.value}
                onChange={field.onChange}
                error={errorText(fieldState.error?.message)}
              />
            )}
          />
        </>
      ) : transferMode === 'link' ? (
        <Controller
          control={control}
          name="transferId"
          render={({ field, fieldState }) => (
            <View style={styles.group}>
              <OptionPicker
                label={t('goals.contribution.link')}
                value={field.value}
                options={candidates}
                onChange={field.onChange}
              />
              {fieldState.error?.message ? (
                <Text variant="bodySmall" tone="negative">
                  {errorText(fieldState.error.message)}
                </Text>
              ) : null}
            </View>
          )}
        />
      ) : (
        <Controller
          control={control}
          name="accountId"
          render={({ field, fieldState }) => (
            <View style={styles.group}>
              <OptionPicker
                label={t('goals.contribution.account')}
                value={field.value ?? NONE}
                options={accountOptions}
                onChange={(next) => field.onChange(next === NONE ? null : next)}
              />
              {fieldState.error?.message ? (
                <Text variant="bodySmall" tone="negative">
                  {errorText(fieldState.error.message)}
                </Text>
              ) : null}
            </View>
          )}
        />
      )}

      <FormTextField
        control={control}
        name="notes"
        label={t('goals.contribution.notes')}
        maxLength={500}
      />

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
