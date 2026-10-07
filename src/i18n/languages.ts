/**
 * Languages with complete translations. Adding one: create locales/<code>.ts
 * (typed as TranslationResources), register it in i18n/index.ts RESOURCES and
 * add it here with its native name.
 */
export const SUPPORTED_LANGUAGES = ['en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const FALLBACK_LANGUAGE: SupportedLanguage = 'en';

/** Shown in the language picker in the language itself. */
export const LANGUAGE_NATIVE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
};

export function isSupportedLanguage(code: string): code is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

/** Primary language subtag: "en-GB" → "en". */
export function languageCodeOf(tag: string): string {
  return (tag.split('-')[0] ?? tag).toLowerCase();
}
