import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { type ColorScheme, type TypographyVariant, useTheme } from '@/theme';

export type TextTone = keyof Pick<
  ColorScheme,
  | 'text'
  | 'textSecondary'
  | 'textMuted'
  | 'textInverse'
  | 'primary'
  | 'positive'
  | 'negative'
  | 'warning'
  | 'onPrimary'
>;

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: TextTone;
  align?: 'auto' | 'left' | 'right' | 'center' | 'justify';
}

const HEADING_VARIANTS: readonly TypographyVariant[] = ['display', 'title', 'heading'];

/**
 * The only text primitive. Scales with the OS font size; headings are exposed
 * to screen readers as headers.
 */
export function Text({
  variant = 'body',
  tone = 'text',
  align,
  style,
  accessibilityRole,
  ...rest
}: TextProps) {
  const theme = useTheme();
  return (
    <RNText
      accessibilityRole={
        accessibilityRole ?? (HEADING_VARIANTS.includes(variant) ? 'header' : undefined)
      }
      style={[
        theme.typography[variant],
        { color: theme.colors[tone] },
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  );
}
