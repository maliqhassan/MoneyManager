import { type ColorScheme, darkColors, lightColors } from '../colors';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const AA_TEXT = 4.5;

const textPairs: [keyof ColorScheme, keyof ColorScheme][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['textSecondary', 'background'],
  ['textSecondary', 'surface'],
  ['textMuted', 'surface'],
  ['onPrimary', 'primary'],
  ['onPrimaryMuted', 'primaryMuted'],
  ['primary', 'surface'],
  ['positive', 'surface'],
  ['negative', 'surface'],
  ['warning', 'surface'],
  ['positive', 'positiveMuted'],
  ['negative', 'negativeMuted'],
  ['warning', 'warningMuted'],
];

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
])('%s theme contrast', (_name, colors) => {
  it.each(textPairs)('%s on %s meets WCAG AA', (fg, bg) => {
    expect(contrast(colors[fg], colors[bg])).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
