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

  // Brand: violet on a soft lavender canvas.
  violet50: '#F6F5FB',
  violet100: '#EEEBFF',
  violet200: '#E8E5F1',
  violet300: '#D4D0E3',
  violet500: '#7A66F2',
  violet600: '#5B45E0',
  violet700: '#4A34C7',
  ink900: '#17152B',
  ink600: '#57546D',
  ink500: '#706D86',
  lavender100: '#F1EFF8',
  coral500: '#E0773A',

  amber50: '#FFF5E0',
  amber400: '#F5B544',
  amber700: '#8A5A00',
  amber900: '#3D2A06',
  // Chart series (validated as a CVD-safe pair with blue600 / blue500).
  orange500: '#EB6834',
  orange600: '#D95926',
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
  /** Screen side margin. */
  gutter: 20,
  /** Between sections of a screen. */
  section: 28,
} as const;
export type SpacingToken = keyof typeof spacing;

export const radius = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;
export type RadiusToken = keyof typeof radius;

/** Minimum touch target (Apple HIG 44pt, Material 48dp → use 48). */
export const MIN_TOUCH_TARGET = 48;

/** Upper bound for Dynamic Type scaling on dense UI (tab labels, badges). */
export const MAX_FONT_SCALE_DENSE = 1.4;

/**
 * Two typefaces, embedded at build time (expo-font config plugin):
 * - Plus Jakarta Sans (600/700/800) for display, titles and the hero amount —
 *   friendly, geometric, with presence;
 * - Inter (400/500/600) for everything read or scanned — UI text, labels and
 *   numbers (tabular figures keep amounts aligned).
 * On Android the weights are grouped into one family each, so fontWeight
 * selects the file; on iOS the family name comes from the font files.
 */
export const FONT_DISPLAY = Platform.select({
  ios: 'Plus Jakarta Sans',
  default: 'PlusJakartaSans',
});
export const FONT_TEXT = 'Inter';

type TypeStyle = Pick<
  TextStyle,
  | 'fontSize'
  | 'lineHeight'
  | 'fontWeight'
  | 'fontFamily'
  | 'letterSpacing'
  | 'fontVariant'
  | 'textTransform'
>;

/**
 * Type scale — roughly a major third (×1.25) on a 4-pt grid: 12 · 14 · 16 ·
 * 20 · 28 · 36. Body text is 16 and nothing is below 12. Larger sizes get
 * tighter tracking; all-caps labels get +0.075em. Sizes follow the OS text
 * size (allowFontScaling is on).
 */
export const typography = {
  display: {
    fontFamily: FONT_DISPLAY,
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: -0.9,
  },
  title: {
    fontFamily: FONT_DISPLAY,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  heading: {
    fontFamily: FONT_DISPLAY,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  body: { fontFamily: FONT_TEXT, fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontFamily: FONT_TEXT, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label: {
    fontFamily: FONT_TEXT,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  bodySmall: { fontFamily: FONT_TEXT, fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: {
    fontFamily: FONT_TEXT,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  /** Section labels: short, all caps, letter-spaced. */
  overline: {
    fontFamily: FONT_TEXT,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  /** Money amounts: tabular figures keep columns of numbers aligned. */
  amountLarge: {
    fontFamily: FONT_DISPLAY,
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.9,
  },
  amount: {
    fontFamily: FONT_TEXT,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
} as const satisfies Record<string, TypeStyle>;
export type TypographyVariant = keyof typeof typography;

/**
 * Soft, layered shadows (CSS box-shadow, tinted with the ink colour) — depth
 * is quiet; borders and contrast do most of the work.
 */
export const elevation = {
  none: {},
  low: { boxShadow: '0 1px 2px rgba(23, 21, 43, 0.04), 0 2px 8px rgba(23, 21, 43, 0.04)' },
  medium: { boxShadow: '0 4px 12px rgba(23, 21, 43, 0.06), 0 12px 32px rgba(23, 21, 43, 0.08)' },
  /** Bottom bar: a soft shadow cast upward instead of a hard line. */
  bar: { boxShadow: '0 -1px 0 rgba(23, 21, 43, 0.05), 0 -8px 24px rgba(23, 21, 43, 0.06)' },
  /** The main action (raised +): a violet glow. */
  brand: { boxShadow: '0 8px 20px rgba(91, 69, 224, 0.35)' },
} as const satisfies Record<string, ViewStyle>;
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
