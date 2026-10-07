import type { Money } from '@/domain/money/money';
import type { MoneyFormatOptions } from '@/i18n/format';
import { useFormatter } from '@/i18n/FormatContext';

import { Text, type TextProps } from './Text';

export interface MoneyTextProps extends Omit<TextProps, 'children' | 'tone'> {
  value: Money;
  /** Color positive green / negative red (for flows). Off for neutral balances. */
  colorBySign?: boolean;
  format?: MoneyFormatOptions;
}

/**
 * Displays a monetary amount with exact, locale-aware formatting (from the
 * user's number-format preference) and tabular figures. Sign is never
 * conveyed by color alone (the minus/plus is always rendered).
 */
export function MoneyText({
  value,
  colorBySign = false,
  format,
  variant = 'amount',
  ...rest
}: MoneyTextProps) {
  const formatter = useFormatter();
  const tone =
    !colorBySign || value.amountMinor === 0
      ? 'text'
      : value.amountMinor > 0
        ? 'positive'
        : 'negative';
  return (
    <Text variant={variant} tone={tone} {...rest}>
      {formatter.money(value, format)}
    </Text>
  );
}
