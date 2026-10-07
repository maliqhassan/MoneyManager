import type { TFunction } from 'i18next';

/**
 * Validation messages are i18n keys produced by Zod schemas (e.g.
 * "validation.required"). Unknown keys fall back to a generic message rather
 * than leaking raw keys or internal text to the user.
 */
export function translateMessage(t: TFunction, key: string): string {
  return t(key as 'validation.required', { defaultValue: t('errors.validation') });
}
