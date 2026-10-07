import { useContext, useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { type Theme, ThemeContext } from './ThemeProvider';

export { type Theme, ThemeProvider } from './ThemeProvider';
export type { ColorScheme } from './colors';
export * from './tokens';

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

type NamedStyles<T> = StyleSheet.NamedStyles<T>;

/**
 * Declares theme-aware styles once, outside the component:
 *
 *   const useStyles = makeStyles((t) => ({ card: { backgroundColor: t.colors.surface } }));
 *   function Card() { const styles = useStyles(); … }
 *
 * Styles are recomputed only when the theme changes.
 */
export function makeStyles<T extends NamedStyles<T>>(factory: (theme: Theme) => T) {
  return function useStyles(): T {
    const theme = useTheme();
    return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
  };
}
