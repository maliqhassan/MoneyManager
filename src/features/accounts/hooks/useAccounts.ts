import { useMutation, useQuery } from '@tanstack/react-query';

import type { CurrencyCode } from '@/domain/currency/currencies';
import { buildAccountsOverview } from '@/domain/accounts/accounts';
import type { Account } from '@/domain/models';
import type { DecimalString } from '@/domain/money/decimal';
import { useFormatter } from '@/i18n/FormatContext';
import { queryKeys } from '@/lib/queryClient';
import { useRepositories } from '@/providers/DataProvider';
import type { AccountInput, AccountUpdate } from '@/validation/entities';

/**
 * Account data for screens. All reads hit local SQLite (offline-first); all
 * arithmetic happens in the domain layer — hooks only wire data together.
 */

export function useAccounts(options: { includeArchived?: boolean } = {}) {
  const { accounts } = useRepositories();
  const includeArchived = options.includeArchived ?? false;
  return useQuery({
    queryKey: queryKeys.accounts.list(includeArchived),
    queryFn: () => accounts.list({ includeArchived }),
  });
}

export function useAccount(id: string) {
  const { accounts } = useRepositories();
  return useQuery({
    queryKey: queryKeys.accounts.detail(id),
    enabled: id.length > 0,
    queryFn: async () => {
      const [account, balances, usage] = await Promise.all([
        accounts.getById(id),
        accounts.getBalances(),
        accounts.getUsage(id),
      ]);
      if (!account) return null;
      const balance = balances.find((b) => b.accountId === id)?.balance ?? {
        amountMinor: account.openingBalanceMinor,
        currency: account.currency,
      };
      return { account, balance, usage };
    },
  });
}

/**
 * Grouped accounts with per-currency totals and — only when every needed
 * exchange rate is known — a combined base-currency total.
 */
export function useAccountsOverview() {
  const repos = useRepositories();
  const formatter = useFormatter();
  const base = formatter.settings.baseCurrency;
  const today = formatter.today();

  return useQuery({
    queryKey: queryKeys.accounts.overview(base, today),
    queryFn: async () => {
      const [list, balances] = await Promise.all([
        repos.accounts.list({ includeArchived: true }),
        repos.accounts.getBalances(),
      ]);
      const currencies = [...new Set(list.map((a) => a.currency))].filter((c) => c !== base);
      const rates = new Map<CurrencyCode, DecimalString | null>();
      await Promise.all(
        currencies.map(async (c) =>
          rates.set(c, await repos.exchangeRates.findRate(c, base, today)),
        ),
      );
      const balanceMap = new Map(balances.map((b) => [b.accountId, b.balance]));
      return buildAccountsOverview<Account>(list, balanceMap, base, (c) => rates.get(c) ?? null);
    },
  });
}

export function useAccountMutations() {
  const { accounts } = useRepositories();
  return {
    create: useMutation({ mutationFn: (input: AccountInput) => accounts.create(input) }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: AccountUpdate }) =>
        accounts.update(id, patch),
    }),
    changeCurrency: useMutation({
      mutationFn: ({
        id,
        currency,
        openingBalanceMinor,
      }: {
        id: string;
        currency: CurrencyCode;
        openingBalanceMinor: number;
      }) => accounts.changeCurrency(id, currency, openingBalanceMinor),
    }),
    setArchived: useMutation({
      mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
        accounts.setArchived(id, archived),
    }),
    remove: useMutation({ mutationFn: (id: string) => accounts.remove(id) }),
  };
}
