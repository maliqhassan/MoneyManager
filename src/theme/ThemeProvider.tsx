import * as SystemUI from 'expo-system-ui';
import { createContext, type PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { type ColorScheme, lightColors } from './colors';
import { elevation, MIN_TOUCH_TARGET, radius, spacing, typography } from './tokens';

/** The app has a single light theme (no dark mode). */
export interface Theme {
  colors: ColorScheme;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  elevation: typeof elevation;
  minTouchTarget: number;
  /** Mirrors the OS "reduce motion" setting; animations must honour it. */
  reduceMotion: boolean;
}

export function buildTheme(reduceMotion: boolean): Theme {
  return {
    colors: lightColors,
    spacing,
    radius,
    typography,
    elevation,
    minTouchTarget: MIN_TOUCH_TARGET,
    reduceMotion,
  };
}

export const ThemeContext = createContext<Theme>(buildTheme(false));

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduceMotion;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const reduceMotion = useReduceMotion();
  const theme = useMemo(() => buildTheme(reduceMotion), [reduceMotion]);

  useEffect(() => {
    // Root view background shows during transitions and keyboard animations.
    void SystemUI.setBackgroundColorAsync(theme.colors.background);
  }, [theme.colors.background]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
