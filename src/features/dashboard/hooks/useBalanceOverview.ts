import { useMemo } from 'react';

import { useAccountBalances, useAccounts } from '@/features/accounts/hooks/useAccounts';
import { usePreferences } from '@/features/settings/hooks/usePreferences';
import type { CurrencyCode } from '@/domain/currency/currencies';
import { totalInBaseCurrency } from '@/domain/finance/balance';
import { getDeviceLocale } from '@/i18n/locale';

/**
 * Total balance across accounts included in totals, in the base currency.
 * All arithmetic happens in the domain layer; this hook only wires data.
 *
 * Exchange rates are not loaded yet (multi-currency phase), so foreign
 * balances are reported in `missingRates` instead of being guessed.
 */
export function useBalanceOverview() {
  const accounts = useAccounts();
  const balances = useAccountBalances();
  const preferences = usePreferences();

  const baseCurrency: CurrencyCode = preferences.data?.baseCurrency ?? getDeviceLocale().currency;

  const overview = useMemo(() => {
    if (!accounts.data || !balances.data) return null;
    const included = new Set(accounts.data.filter((a) => a.includeInTotals).map((a) => a.id));
    const relevant = balances.data.filter((b) => included.has(b.accountId)).map((b) => b.balance);
    return {
      accountCount: accounts.data.length,
      ...totalInBaseCurrency(relevant, baseCurrency, () => null),
    };
  }, [accounts.data, balances.data, baseCurrency]);

  return {
    overview,
    isLoading: accounts.isLoading || balances.isLoading,
    error: accounts.error ?? balances.error,
    refetch: () => Promise.all([accounts.refetch(), balances.refetch(), preferences.refetch()]),
    isRefetching: accounts.isRefetching || balances.isRefetching,
  };
}
