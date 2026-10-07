import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initI18n } from '@/i18n';
import { FormatContext } from '@/i18n/FormatContext';
import { createFormatter, type FormatSettings } from '@/i18n/formatter';
import { buildTheme, ThemeContext } from '@/theme/ThemeProvider';

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

/**
 * Renders a component with the app's theme, translations and a deterministic
 * formatter, without persisted stores or native modules.
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    scheme = 'light',
    format = TEST_FORMAT_SETTINGS,
    ...options
  }: RenderOptions & { scheme?: 'light' | 'dark'; format?: FormatSettings } = {},
) {
  const theme = buildTheme(scheme, true);
  const formatter = createFormatter(format);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <I18nextProvider i18n={i18n}>
        <ThemeContext.Provider value={theme}>
          <FormatContext.Provider value={formatter}>{children}</FormatContext.Provider>
        </ThemeContext.Provider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
  return render(ui, { wrapper: Wrapper, ...options });
}
