import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type PropsWithChildren, useMemo, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initI18n } from '@/i18n';
import { createQueryClient, wireQueryManagers } from '@/lib/queryClient';
import { ThemeProvider, useTheme } from '@/theme';

const i18n = initI18n();
wireQueryManagers();

/** Maps our semantic colors onto React Navigation's theme (headers, tab bar, cards). */
function NavigationTheme({ children }: PropsWithChildren) {
  const theme = useTheme();
  const navTheme = useMemo(() => {
    const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.primary,
        background: theme.colors.background,
        card: theme.colors.tabBar,
        text: theme.colors.text,
        border: theme.colors.border,
        notification: theme.colors.negative,
      },
    };
  }, [theme]);

  return (
    <NavigationThemeProvider value={navTheme}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </NavigationThemeProvider>
  );
}

/** Providers that do not depend on the signed-in user. */
export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(createQueryClient);
  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <NavigationTheme>{children}</NavigationTheme>
          </ThemeProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
