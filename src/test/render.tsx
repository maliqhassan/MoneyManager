import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initI18n } from '@/i18n';
import { FormatContext } from '@/i18n/FormatContext';
import { createFormatter, type FormatSettings } from '@/i18n/formatter';
import { DataContext, type DataContextValue } from '@/providers/DataProvider';
import { SyncEngine } from '@/sync/SyncEngine';
import { buildTheme, ThemeContext } from '@/theme/ThemeProvider';

import { FakeRemote } from './fakeRemote';
import { sequentialIds } from './factories';
import type { Ledger } from './ledger';

const i18n = initI18n();

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export const TEST_FORMAT_SETTINGS: FormatSettings = {
  locale: 'en-US',
  language: 'en',
  region: 'US',
  numberFormat: 'locale',
  dateFormat: 'locale',
  timeZone: 'America/New_York',
  firstDayOfWeek: 0,
  baseCurrency: 'USD',
};

function dataValue(ledger: Ledger): DataContextValue {
  return {
    mode: 'account',
    db: ledger.db,
    repositories: ledger.repos,
    syncEngine: new SyncEngine({ db: ledger.db, remote: new FakeRemote(), newId: sequentialIds() }),
    destroyLocalData: async () => undefined,
    onLocalChange: () => () => undefined,
  };
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'always', gcTime: Infinity } },
  });
}

/**
 * Renders a component with the app's theme, translations and a deterministic
 * formatter. Pass a `ledger` (test/ledger.ts) for components that read data
 * through repositories; it is backed by real in-memory SQLite.
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    format = TEST_FORMAT_SETTINGS,
    ledger,
    queryClient: providedClient,
    ...options
  }: RenderOptions & {
    format?: FormatSettings;
    ledger?: Ledger;
    /** Pass one to drive invalidation from the test (as DataProvider does). */
    queryClient?: QueryClient;
  } = {},
) {
  const theme = buildTheme(true);
  const formatter = createFormatter(format);
  const queryClient = providedClient ?? createTestQueryClient();
  const data = ledger ? dataValue(ledger) : null;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <DataContext.Provider value={data}>
            <ThemeContext.Provider value={theme}>
              <FormatContext.Provider value={formatter}>{children}</FormatContext.Provider>
            </ThemeContext.Provider>
          </DataContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
  return render(ui, { wrapper: Wrapper, ...options });
}
