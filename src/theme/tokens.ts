import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Design tokens — the only place raw values live. Components consume the
 * semantic theme (see colors.ts / ThemeProvider), never these primitives
 * directly, except spacing/radius/typography which are mode-independent.
 */

/** Raw palette. Do not reference from components; use semantic colors. */
export const palette = {
  white: '#FFFFFF',
  black: '#000000',

  gray50: '#F6F7F9',
  gray100: '#EDEFF3',
  gray200: '#DDE1E7',
  gray300: '#C3C9D2',
  gray400: '#8E98A6',
  gray500: '#677385',
  gray600: '#4D5868',
  gray700: '#363F4C',
  gray800: '#1A212C',
  gray850: '#131922',
  gray900: '#0B0F14',

  blue50: '#EEF3FF',
  blue100: '#DCE6FF',
  blue300: '#9DB6FF',
  blue400: '#7A9BFF',
  blue500: '#4F74F0',
  blue600: '#2F55D4',
  blue700: '#2443AD',
  blue900: '#14244F',

  green50: '#E8F6EF',
  green400: '#4CC38A',
  green600: '#13774F',
  green900: '#0D3524',

  red50: '#FDECEC',
  red400: '#FF7A7A',
  red600: '#C02A35',
  red900: '#43161A',

  amber50: '#FFF5E0',
  amber400: '#F5B544',
  amber700: '#8A5A00',
  amber900: '#3D2A06',
} as const;

/** 4-pt spacing scale. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;
export type SpacingToken = keyof typeof spacing;

export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;
export type RadiusToken = keyof typeof radius;

/** Minimum touch target (Apple HIG 44pt, Material 48dp → use 48). */
export const MIN_TOUCH_TARGET = 48;

/** Upper bound for Dynamic Type scaling on dense UI (tab labels, badges). */
export const MAX_FONT_SCALE_DENSE = 1.4;

const fontFamily = Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' });
const fontFamilyMedium = Platform.select({
  ios: 'System',
  android: 'sans-serif-medium',
  default: 'System',
});

type TypeStyle = Pick<
  TextStyle,
  'fontSize' | 'lineHeight' | 'fontWeight' | 'fontFamily' | 'letterSpacing' | 'fontVariant'
>;

/**
 * Type scale. Body text is 16 to stay readable; nothing below 12. Sizes scale
 * with the OS text-size setting (allowFontScaling is on by default).
 */
export const typography = {
  display: { fontFamily, fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.4 },
  title: { fontFamily, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontFamily: fontFamilyMedium, fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontFamily, fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontFamily: fontFamilyMedium, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label: { fontFamily: fontFamilyMedium, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  bodySmall: { fontFamily, fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontFamily, fontSize: 12, lineHeight: 16, fontWeight: '400' },
  /** Money amounts: tabular figures keep columns of numbers aligned. */
  amountLarge: {
    fontFamily,
    fontSize: 34,
    lineHeight: 41,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.4,
  },
  amount: {
    fontFamily: fontFamilyMedium,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
} as const satisfies Record<string, TypeStyle>;
export type TypographyVariant = keyof typeof typography;

/** Subtle elevation only — the UI relies on borders and contrast, not heavy shadows. */
export const elevation = {
  none: {},
  low: Platform.select<ViewStyle>({
    ios: {
      shadowColor: palette.black,
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
    default: { elevation: 1 },
  }),
  medium: Platform.select<ViewStyle>({
    ios: {
      shadowColor: palette.black,
      shadowOpacity: 0.1,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
    default: { elevation: 4 },
  }),
} as const;
export type ElevationToken = keyof typeof elevation;

export const motion = {
  fast: 150,
  normal: 250,
} as const;

/**
 * Account accent colors. Used as the background of account icons with a
 * white glyph, so each must keep ≥ 3:1 contrast against white in both themes
 * (verified in theme/__tests__/contrast.test.ts). Stored on accounts as hex.
 */
export const ACCOUNT_COLORS = [
  '#2F55D4', // blue
  '#13774F', // green
  '#0E7490', // teal
  '#6B46C1', // violet
  '#BE185D', // pink
  '#C02A35', // red
  '#B45309', // orange
  '#8A5A00', // amber
  '#4D5868', // slate
  '#1E3A8A', // navy
] as const;
export type AccountColor = (typeof ACCOUNT_COLORS)[number];
