import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { FormTextField } from '@/components/form/FormTextField';
import { translateMessage } from '@/components/form/translateMessage';
import { Button, ChoiceChips, OptionPicker, SwitchRow, Text, TextField } from '@/components/ui';
import { isLiability, openingBalanceFromEntry } from '@/domain/accounts/accounts';
import { ACCOUNT_TYPES, type AccountType } from '@/domain/enums';
import { parseAmountEntry } from '@/domain/money/parse';
import { FormError } from '@/features/auth/components/FormError';
import { useCurrencyOptions } from '@/features/regional/options';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles } from '@/theme';

import { type AccountFormValues, createAccountFormSchema } from '../formSchema';
import { ACCOUNT_TYPE_ICONS, DEFAULT_ACCOUNT_COLORS } from '../meta';
import { AccountColorPicker, AccountIconPicker } from './AppearancePickers';

export interface AccountFormProps {
  initialValues: AccountFormValues;
  submitLabel: string;
  onSubmit: (values: AccountFormValues) => Promise<void>;
  /** Currency cannot change once the account has history. */
  currencyLocked?: boolean;
  /** Show icon/color/notes/totals (hidden in the short onboarding version). */
  showAdvanced?: boolean;
  submitError?: unknown;
  secondaryAction?: { label: string; onPress: () => void };
}

export function AccountForm({
  initialValues,
  submitLabel,
  onSubmit,
  currencyLocked = false,
  showAdvanced = true,
  submitError,
  secondaryAction,
}: AccountFormProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const formatter = useFormatter();
  const decimal = formatter.separators.decimal;
  const schema = useMemo(() => createAccountFormSchema(decimal), [decimal]);
  const currencyOptions = useCurrencyOptions(formatter.numberLocale);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, setValue, getValues } = useForm<AccountFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: 'onTouched',
  });
  const [type, currency, amount, color] = useWatch({
    control,
    name: ['type', 'currency', 'amount', 'color'],
  });
  const liability = isLiability(type);

  const changeType = (next: AccountType) => {
    const previous = getValues('type');
    // Keep the user's own icon/color choice; only follow defaults if untouched.
    if (getValues('icon') === ACCOUNT_TYPE_ICONS[previous])
      setValue('icon', ACCOUNT_TYPE_ICONS[next]);
    if (getValues('color') === DEFAULT_ACCOUNT_COLORS[previous]) {
      setValue('color', DEFAULT_ACCOUNT_COLORS[next]);
    }
    setValue('type', next, { shouldValidate: true });
  };

  const preview = useMemo(() => {
    if (!amount.trim()) return null;
    const parsed = parseAmountEntry(amount, currency, decimal);
    if (!parsed.ok) return null;
    const stored = openingBalanceFromEntry(type, parsed.value.amountMinor);
    return formatter.money({ amountMinor: stored, currency });
  }, [amount, currency, decimal, formatter, type]);

  const submit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <View style={styles.form}>
      <FormTextField
        control={control}
        name="name"
        label={t('accounts.fields.name')}
        placeholder={t('accounts.fields.namePlaceholder')}
        autoCapitalize="sentences"
        returnKeyType="next"
        maxLength={100}
      />

      <ChoiceChips
        label={t('accounts.fields.type')}
        value={type}
        onChange={changeType}
        choices={ACCOUNT_TYPES.map((value) => ({
          value,
          label: t(`accounts.types.${value}`),
          icon: ACCOUNT_TYPE_ICONS[value],
          accessibilityHint: t(`accounts.typeHints.${value}`),
        }))}
      />

      <Controller
        control={control}
        name="currency"
        render={({ field }) => (
          <OptionPicker
            label={t('accounts.fields.currency')}
            value={field.value}
            options={currencyOptions}
            onChange={(v) => field.onChange(v)}
            searchable
            disabled={currencyLocked}
            hint={
              currencyLocked
                ? `${t('accounts.currencyLocked')} ${t('accounts.currencyLockedAlternative')}`
                : undefined
            }
          />
        )}
      />

      <Controller
        control={control}
        name="amount"
        render={({ field, fieldState }) => (
          <TextField
            label={
              liability ? t('accounts.fields.amountOwed') : t('accounts.fields.openingBalance')
            }
            hint={
              liability
                ? t('accounts.fields.amountOwedHint')
                : t('accounts.fields.openingBalanceHint')
            }
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            keyboardType="decimal-pad"
            placeholder={formatter.amountForInput({ amountMinor: 0, currency })}
            prefix={formatter.currencySymbol(currency)}
            error={fieldState.error?.message ? translateMessage(t, fieldState.error.message) : null}
            footer={
              preview ? (
                <Text variant="bodySmall" tone="textSecondary">
                  {t('accounts.preview', { amount: preview })}
                </Text>
              ) : null
            }
            trailing={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('accounts.signToggle')}
                onPress={() => {
                  const v = field.value.trim();
                  field.onChange(v.startsWith('-') ? v.slice(1) : `-${v}`);
                }}
                style={styles.signToggle}
              >
                <Text variant="bodyStrong" tone="textSecondary">
                  ±
                </Text>
              </Pressable>
            }
          />
        )}
      />

      {type === 'credit_card' ? (
        <Controller
          control={control}
          name="creditLimit"
          render={({ field, fieldState }) => (
            <TextField
              label={`${t('accounts.fields.creditLimit')} (${t('common.optional')})`}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              keyboardType="decimal-pad"
              prefix={formatter.currencySymbol(currency)}
              error={
                fieldState.error?.message ? translateMessage(t, fieldState.error.message) : null
              }
            />
          )}
        />
      ) : null}

      {showAdvanced ? (
        <>
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
            render={({ field }) => (
              <AccountColorPicker value={field.value} onChange={field.onChange} />
            )}
          />
          <FormTextField
            control={control}
            name="notes"
            label={`${t('accounts.fields.notes')} (${t('common.optional')})`}
            multiline
            maxLength={1000}
          />
          <Controller
            control={control}
            name="includeInTotals"
            render={({ field }) => (
              <SwitchRow
                label={t('accounts.fields.includeInTotals')}
                hint={t('accounts.fields.includeInTotalsHint')}
                value={field.value}
                onValueChange={field.onChange}
              />
            )}
          />
        </>
      ) : null}

      <FormError error={submitError} />
      <Button label={submitLabel} loading={submitting} onPress={submit} />
      {secondaryAction ? (
        <Button
          label={secondaryAction.label}
          variant="ghost"
          size="md"
          onPress={secondaryAction.onPress}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  form: { gap: t.spacing.lg },
  signToggle: {
    minWidth: t.minTouchTarget,
    minHeight: t.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
