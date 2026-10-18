import { create } from 'zustand';

import type { CurrencyCode } from '@/domain/currency/currencies';
import type { ExchangeRateRepository } from '@/repositories/types';
import { FrankfurterProvider, type RateProvider } from '@/services/fx/provider';
import { refreshExchangeRates, type RefreshOutcome } from '@/services/fx/refresh';
import { logger } from '@/services/monitoring/logger';

interface FxRefreshState {
  refreshing: boolean;
  last: RefreshOutcome | null;
  set: (patch: Partial<Omit<FxRefreshState, 'set'>>) => void;
}

/** Status of the foreground rate refresh (memory only). */
export const useFxRefreshStore = create<FxRefreshState>()((set) => ({
  refreshing: false,
  last: null,
  set: (patch) => set(patch),
}));

let provider: RateProvider = new FrankfurterProvider();
let inFlight: Promise<RefreshOutcome> | null = null;

/** Tests swap the provider (no network in tests). */
export function setRateProviderForTests(p: RateProvider): void {
  provider = p;
}

export function rateProvider(): RateProvider {
  return provider;
}

/**
 * Runs one refresh at a time; concurrent callers share it. Never throws:
 * failures are reported in the outcome and cached rates stay as they were.
 */
export function runRateRefresh(input: {
  rates: ExchangeRateRepository;
  baseCurrency: CurrencyCode;
  today: string;
  force?: boolean;
}): Promise<RefreshOutcome> {
  if (inFlight) return inFlight;
  const store = useFxRefreshStore.getState();
  store.set({ refreshing: true });
  inFlight = refreshExchangeRates({
    rates: input.rates,
    provider,
    baseCurrency: input.baseCurrency,
    today: input.today,
    now: () => new Date(),
    force: input.force ?? false,
  })
    .catch((error: unknown): RefreshOutcome => {
      // Storage errors etc.; only the error type is logged (no rate data).
      logger.warn('Exchange-rate refresh failed', { name: (error as Error)?.name });
      return { status: 'failed', error: 'invalid', written: 0 };
    })
    .then((outcome) => {
      useFxRefreshStore.getState().set({ refreshing: false, last: outcome });
      return outcome;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
