import { palette } from './tokens';

/**
 * Semantic color roles. Components use only these names, so light/dark (and
 * any future brand theme) are a matter of swapping one object.
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
  background: palette.gray50,
  surface: palette.white,
  surfaceRaised: palette.white,
  surfaceMuted: palette.gray100,
  border: palette.gray200,
  borderStrong: palette.gray300,

  text: palette.gray900,
  textSecondary: palette.gray600,
  textMuted: palette.gray500,
  textInverse: palette.white,

  primary: palette.blue600,
  primaryPressed: palette.blue700,
  onPrimary: palette.white,
  primaryMuted: palette.blue50,
  onPrimaryMuted: palette.blue700,

  positive: palette.green600,
  positiveMuted: palette.green50,
  negative: palette.red600,
  negativeMuted: palette.red50,
  warning: palette.amber700,
  warningMuted: palette.amber50,

  onAccent: palette.white,
  focusRing: palette.blue500,
  overlay: 'rgba(11, 15, 20, 0.45)',
  skeleton: palette.gray100,
  tabBar: palette.white,
  chartIncome: palette.blue600,
  chartSpending: palette.orange500,
};

export const darkColors: ColorScheme = {
  background: palette.gray900,
  surface: palette.gray850,
  surfaceRaised: palette.gray800,
  surfaceMuted: palette.gray800,
  border: palette.gray700,
  borderStrong: palette.gray600,

  text: palette.gray50,
  textSecondary: palette.gray300,
  textMuted: palette.gray400,
  textInverse: palette.gray900,

  primary: palette.blue400,
  primaryPressed: palette.blue300,
  onPrimary: palette.gray900,
  primaryMuted: palette.blue900,
  onPrimaryMuted: palette.blue100,

  positive: palette.green400,
  positiveMuted: palette.green900,
  negative: palette.red400,
  negativeMuted: palette.red900,
  warning: palette.amber400,
  warningMuted: palette.amber900,

  onAccent: palette.white,
  focusRing: palette.blue300,
  overlay: 'rgba(0, 0, 0, 0.6)',
  skeleton: palette.gray800,
  tabBar: palette.gray850,
  chartIncome: palette.blue500,
  chartSpending: palette.orange600,
};
