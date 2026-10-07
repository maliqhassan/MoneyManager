import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { OptionPicker } from '@/components/ui';
import type { Account } from '@/domain/models';
import { AccountIcon } from '@/features/accounts/components/AccountIcon';

/**
 * Account selector for transactions. Archived accounts are listed but
 * disabled with an explanation — unless already selected on a historical
 * transaction, which keeps showing it.
 */
export function AccountPickerField({
  label,
  accounts,
  value,
  onChange,
  error,
  excludeId,
}: {
  label: string;
  accounts: readonly Account[];
  value: string;
  onChange: (id: string) => void;
  error?: string | null;
  excludeId?: string;
}) {
  const { t } = useTranslation();
  const options = useMemo(
    () =>
      accounts
        .filter((a) => a.id !== excludeId)
        .map((a) => ({
          value: a.id,
          label: a.name,
          description: a.isArchived
            ? t('transactions.accountArchivedOption')
            : `${t(`accounts.types.${a.type}`)} · ${a.currency}`,
          disabled: a.isArchived && a.id !== value,
          leading: <AccountIcon type={a.type} icon={a.icon} color={a.color} size={28} />,
        })),
    [accounts, excludeId, t, value],
  );
  return (
    <OptionPicker
      label={label}
      value={value || null}
      options={options}
      onChange={onChange}
      searchable={accounts.length > 6}
      placeholder={t('transactions.errors.accountNotFound')}
      hint={error ?? undefined}
    />
  );
}
