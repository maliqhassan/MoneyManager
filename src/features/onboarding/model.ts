import type { CurrencyCode } from '@/domain/currency/currencies';
import type { DateFormat, NumberFormat, Weekday } from '@/domain/enums';
import { buildLocaleTag } from '@/i18n/format';
import type { FormatSettings } from '@/i18n/formatter';
import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES } from '@/i18n/languages';
import type { PreferencesUpdate } from '@/validation/preferences';

export const ONBOARDING_STEPS = [
  'welcome',
  'currency',
  'region',
  'preferences',
  'account',
  'ready',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Choices collected during onboarding (kept locally until completion). */
export interface OnboardingDraft {
  currency: CurrencyCode;
  region: string | null;
  language: string;
  timeZone: string;
  firstDayOfWeek: Weekday;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
}

export function nextStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)] ?? 'ready';
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

/** Device settings become *suggestions*; the user confirms each one. */
export function suggestDraft(device: FormatSettings): OnboardingDraft {
  const language = (SUPPORTED_LANGUAGES as readonly string[]).includes(device.language)
    ? device.language
    : FALLBACK_LANGUAGE;
  return {
    currency: device.baseCurrency,
    region: device.region,
    language,
    timeZone: device.timeZone,
    firstDayOfWeek: device.firstDayOfWeek,
    dateFormat: 'locale',
    numberFormat: 'locale',
  };
}

/** Formatting settings implied by a draft, for live previews during onboarding. */
export function draftFormatSettings(draft: OnboardingDraft): FormatSettings {
  return {
    locale: buildLocaleTag(draft.language, draft.region),
    language: draft.language,
    region: draft.region,
    numberFormat: draft.numberFormat,
    dateFormat: draft.dateFormat,
    timeZone: draft.timeZone,
    firstDayOfWeek: draft.firstDayOfWeek,
    baseCurrency: draft.currency,
  };
}

/** The preferences write that completes onboarding. */
export function completionUpdate(draft: OnboardingDraft, now: string): PreferencesUpdate {
  return {
    baseCurrency: draft.currency,
    region: draft.region,
    language: draft.language,
    locale: buildLocaleTag(draft.language, draft.region),
    timeZone: draft.timeZone,
    firstDayOfWeek: draft.firstDayOfWeek,
    dateFormat: draft.dateFormat,
    numberFormat: draft.numberFormat,
    onboardingCompletedAt: now,
  };
}

export type AppGate = 'loading' | 'onboarding' | 'ready';

export interface AppGateInput {
  preferencesLoading: boolean;
  preferences: { onboardingCompletedAt: string | null } | null | undefined;
  /** Online with a live session — a first sync can still deliver preferences. */
  canSyncNow: boolean;
  /** At least one sync attempt has finished (success, error or offline). */
  firstSyncSettled: boolean;
}

/**
 * Decides whether the signed-in user sees the app, onboarding, or a short
 * "setting up" state. Preferences are created server-side at sign-up, so a
 * returning user on a new device is never shown onboarding just because the
 * first sync has not landed yet.
 */
export function resolveAppGate(input: AppGateInput): AppGate {
  if (input.preferencesLoading) return 'loading';
  if (input.preferences) return input.preferences.onboardingCompletedAt ? 'ready' : 'onboarding';
  if (input.canSyncNow && !input.firstSyncSettled) return 'loading';
  // Offline / sync failed: onboarding can proceed locally; completion waits for preferences.
  return 'onboarding';
}
