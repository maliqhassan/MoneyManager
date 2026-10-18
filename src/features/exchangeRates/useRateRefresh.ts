import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useFormatter } from '@/i18n/FormatContext';
import { useRepositories } from '@/providers/DataProvider';
import { useSyncStore } from '@/stores/syncStore';

import { runRateRefresh } from './refreshStore';

/**
 * Foreground exchange-rate refresh (no background service): on start, when
 * connectivity returns, when the base currency or day changes, and when the
 * app returns to the foreground. The refresh itself throttles (12 h, 15 min
 * after a failure, Retry-After), so these triggers never cause repeated
 * downloads. Transaction entry never waits for it.
 */
export function useRateRefresh(): void {
  const repos = useRepositories();
  const formatter = useFormatter();
  const queryClient = useQueryClient();
  const isOnline = useSyncStore((s) => s.isOnline);
  const base = formatter.settings.baseCurrency;
  const today = formatter.today();

  useEffect(() => {
    if (!isOnline) return undefined;
    let disposed = false;
    const run = () => {
      if (disposed || !useSyncStore.getState().isOnline) return;
      void runRateRefresh({ rates: repos.exchangeRates, baseCurrency: base, today }).then(() => {
        if (!disposed) void queryClient.invalidateQueries({ queryKey: ['exchange_rates'] });
      });
    };
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => {
      disposed = true;
      sub.remove();
    };
  }, [isOnline, base, today, repos, queryClient]);
}
