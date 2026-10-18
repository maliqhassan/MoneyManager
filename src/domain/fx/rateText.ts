import type { DecimalString } from '../money/decimal';

import { validateRate } from './rateMath';

/** The user's number separators (from i18n/format). */
export interface RateSeparators {
  decimal: string;
  group: string;
}

/**
 * Parses a rate typed by the user with their decimal separator. Spaces are
 * ignored; group separators are NOT accepted (a rate like "1,234" is
 * ambiguous), so only digits and one decimal separator are allowed.
 * Returns the validated decimal string, or null.
 */
export function parseRateInput(text: string, separators: RateSeparators): DecimalString | null {
  const compact = text.replace(/[\s\u00A0\u202F]/g, '');
  if (compact === '') return null;
  const escaped = separators.decimal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^\\d*(?:${escaped}\\d*)?$`).test(compact)) return null;
  const plain = compact.replace(separators.decimal, '.');
  const normalized = plain.startsWith('.')
    ? `0${plain}`
    : plain.endsWith('.')
      ? plain.slice(0, -1)
      : plain;
  try {
    return validateRate(normalized);
  } catch {
    return null;
  }
}

/** Shows an exact rate with the user's separators (no rounding, no floats). */
export function formatRateText(rate: DecimalString, separators: RateSeparators): string {
  const [whole = '0', fraction] = rate.split('.');
  const grouped =
    whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, separators.group) : whole;
  return fraction ? `${grouped}${separators.decimal}${fraction}` : grouped;
}
