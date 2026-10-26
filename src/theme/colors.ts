import { palette } from './tokens';

/**
 * Semantic color roles. Components use only these names, never palette
 * values. The app ships a single light theme.
 *
 * Text/background pairs meet WCAG AA (≥ 4.5:1 for body text); see
 * src/theme/__tests__/contrast.test.ts.
 */
export interface ColorScheme {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;

  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  primary: string;
  primaryPressed: string;
  onPrimary: string;
  primaryMuted: string;
  onPrimaryMuted: string;

  /** Money in (income, refunds, positive balances). */
  positive: string;
  positiveMuted: string;
  /** Money out (expenses, overspending, negative balances). */
  negative: string;
  negativeMuted: string;
  warning: string;
  warningMuted: string;

  /** Glyphs on account accent colors (always white; see ACCOUNT_COLORS). */
  onAccent: string;
  focusRing: string;
  overlay: string;
  skeleton: string;
  tabBar: string;
  /**
   * Chart series: income vs spending. A validated colour-blind-safe pair
   * (≥ 3:1 against the surface); charts always add a legend and written
   * values, so colour is never the only cue.
   */
  chartIncome: string;
  chartSpending: string;
}

export const lightColors: ColorScheme = {
  background: palette.violet50,
  surface: palette.white,
  surfaceRaised: palette.white,
  surfaceMuted: palette.lavender100,
  border: palette.violet200,
  borderStrong: palette.violet300,

  text: palette.ink900,
  textSecondary: palette.ink600,
  textMuted: palette.ink500,
  textInverse: palette.white,

  primary: palette.violet600,
  primaryPressed: palette.violet700,
  onPrimary: palette.white,
  primaryMuted: palette.violet100,
  onPrimaryMuted: palette.violet700,

  positive: palette.green600,
  positiveMuted: palette.green50,
  negative: palette.red600,
  negativeMuted: palette.red50,
  warning: palette.amber700,
  warningMuted: palette.amber50,

  onAccent: palette.white,
  focusRing: palette.violet500,
  overlay: 'rgba(11, 15, 20, 0.45)',
  skeleton: palette.gray100,
  tabBar: palette.white,
  chartIncome: palette.violet600,
  chartSpending: palette.coral500,
};
