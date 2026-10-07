import type { Money } from '@/domain/money/money';
import { formatMoney, type MoneyFormatOptions } from '@/i18n/format';
import { useFormatLocale } from '@/hooks/useFormatLocale';

import { Text, type TextProps } from './Text';

export interface MoneyTextProps extends Omit<TextProps, 'children' | 'tone'> {
  value: Money;
  /** Color positive green / negative red (for flows). Off for neutral balances. */
  colorBySign?: boolean;
  format?: MoneyFormatOptions;
}

/**
 * Displays a monetary amount with exact, locale-aware formatting and
 * tabular figures. Sign is never conveyed by color alone (the minus/plus is
 * always rendered) to stay accessible for color-blind users.
 */
export function MoneyText({
  value,
  colorBySign = false,
  format,
  variant = 'amount',
  ...rest
}: MoneyTextProps) {
  const locale = useFormatLocale();
  const tone =
    !colorBySign || value.amountMinor === 0
      ? 'text'
      : value.amountMinor > 0
        ? 'positive'
        : 'negative';
  return (
    <Text variant={variant} tone={tone} {...rest}>
      {formatMoney(value, locale, format)}
    </Text>
  );
}
