import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { FRANKFURTER_ID } from '@/domain/fx/frankfurter';
import { useFormatter } from '@/i18n/FormatContext';
import { useRepositories } from '@/providers/DataProvider';
import type { ManualRateInput } from '@/validation/exchangeRates';

import { runRateRefresh } from './refreshStore';

/** Everything the Exchange rates screen shows (local reads only). */
export function useRatesOverview() {
  const { exchangeRates } = useRepositories();
  const formatter = useFormatter();
  const base = formatter.settings.baseCurrency;
  const today = formatter.today();
  return useQuery({
    queryKey: ['exchange_rates', 'overview', base, today],
    queryFn: async () => {
      const currencies = (await exchangeRates.currenciesInUse()).filter((c) => c !== base);
      const [rows, log, manual] = await Promise.all([
        exchangeRates.currentRates(currencies, base, today),
        exchangeRates.fetchLog(FRANKFURTER_ID),
        exchangeRates.listManualRates(),
      ]);
      return { base, today, rows, log, manual };
    },
  });
}

/** "Refresh now": ignores the 12-hour wait (never the provider's Retry-After). */
export function useRefreshRates() {
  const { exchangeRates } = useRepositories();
  const formatter = useFormatter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      runRateRefresh({
        rates: exchangeRates,
        baseCurrency: formatter.settings.baseCurrency,
        today: formatter.today(),
        force: true,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['exchange_rates'] }),
  });
}

export function useManualRateMutations() {
  const { exchangeRates } = useRepositories();
  const formatter = useFormatter();
  return {
    save: useMutation({
      mutationFn: ({ input, replace }: { input: ManualRateInput; replace: boolean }) =>
        exchangeRates.saveManualRate(input, { today: formatter.today(), replace }),
    }),
    remove: useMutation({ mutationFn: (id: string) => exchangeRates.deleteManualRate(id) }),
  };
}
