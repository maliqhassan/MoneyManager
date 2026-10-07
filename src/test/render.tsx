import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { initI18n } from '@/i18n';
import { buildTheme, ThemeContext } from '@/theme/ThemeProvider';

const i18n = initI18n();

/**
 * Renders a component with the app's theme and translations, without
 * persisted stores or native modules. Use for component tests.
 */
export function renderWithProviders(
  ui: ReactElement,
  { scheme = 'light', ...options }: RenderOptions & { scheme?: 'light' | 'dark' } = {},
) {
  const theme = buildTheme(scheme, true);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </I18nextProvider>
  );
  return render(ui, { wrapper: Wrapper, ...options });
}
