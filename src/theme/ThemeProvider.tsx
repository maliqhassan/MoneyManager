import * as SystemUI from 'expo-system-ui';
import { createContext, type PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

import { useSettingsStore } from '@/stores/settingsStore';

import { type ColorScheme, darkColors, lightColors } from './colors';
import { elevation, MIN_TOUCH_TARGET, radius, spacing, typography } from './tokens';

export interface Theme {
  scheme: 'light' | 'dark';
  colors: ColorScheme;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  elevation: typeof elevation;
  minTouchTarget: number;
  /** Mirrors the OS "reduce motion" setting; animations must honour it. */
  reduceMotion: boolean;
}

export function buildTheme(scheme: 'light' | 'dark', reduceMotion: boolean): Theme {
  return {
    scheme,
    colors: scheme === 'dark' ? darkColors : lightColors,
    spacing,
    radius,
    typography,
    elevation,
    minTouchTarget: MIN_TOUCH_TARGET,
    reduceMotion,
  };
}

export const ThemeContext = createContext<Theme>(buildTheme('light', false));

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
  const systemScheme = useColorScheme();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const reduceMotion = useReduceMotion();

  const scheme: 'light' | 'dark' =
    themeMode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : themeMode;

  const theme = useMemo(() => buildTheme(scheme, reduceMotion), [scheme, reduceMotion]);

  useEffect(() => {
    // Root view background shows during transitions and keyboard animations.
    void SystemUI.setBackgroundColorAsync(theme.colors.background);
  }, [theme.colors.background]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
