import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';

import { en } from './locales/en';
import { FALLBACK_LANGUAGE, isSupportedLanguage, type SupportedLanguage } from './languages';
import { getDeviceLocale } from './locale';

/**
 * i18n bootstrap.
 *
 * Adding a language: create locales/<code>.ts typed as TranslationResources,
 * register it in RESOURCES, and list it in SUPPORTED_LANGUAGES. Missing keys
 * fall back to English.
 *
 * RTL: layouts use logical properties (start/end, marginStart/paddingEnd),
 * never left/right, so mirroring works automatically. When an RTL language is
 * added, call I18nManager.forceRTL(isRTL) and reload the app on change.
 */
export const RESOURCES: Record<SupportedLanguage, { translation: typeof en }> = {
  en: { translation: en },
};

function resolveLanguage(code: string): SupportedLanguage {
  return isSupportedLanguage(code) ? code : FALLBACK_LANGUAGE;
}

/** Switches the UI language (no-op for unsupported codes). */
export function applyLanguage(code: string): void {
  const next = resolveLanguage(code);
  if (initialized && i18n.language !== next) void i18n.changeLanguage(next);
}

const i18n = createInstance();
let initialized = false;

export function initI18n(): typeof i18n {
  if (initialized) return i18n;
  initialized = true;

  const device = getDeviceLocale();
  I18nManager.allowRTL(true);

  void i18n.use(initReactI18next).init({
    resources: RESOURCES,
    lng: resolveLanguage(device.languageCode),
    fallbackLng: FALLBACK_LANGUAGE,
    interpolation: { escapeValue: false }, // React Native does not render HTML
    returnNull: false,
    initAsync: false,
  });
  return i18n;
}

export { i18n };
