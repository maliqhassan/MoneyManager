import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryClient';
import { useRepositories } from '@/providers/DataProvider';

export function useAccounts(options: { includeArchived?: boolean } = {}) {
  const { accounts } = useRepositories();
  const includeArchived = options.includeArchived ?? false;
  return useQuery({
    queryKey: queryKeys.accounts.list(includeArchived),
    queryFn: () => accounts.list({ includeArchived }),
  });
}

export function useAccountBalances() {
  const { accounts } = useRepositories();
  return useQuery({
    queryKey: queryKeys.accounts.balances(),
    queryFn: () => accounts.getBalances(),
  });
}
