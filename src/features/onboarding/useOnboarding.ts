import { type Href, router } from 'expo-router';
import { useCallback } from 'react';

import { useAuthStore } from '@/stores/authStore';

import { nextStep, type OnboardingDraft, type OnboardingStep } from './model';
import { useOnboardingStore } from './store';

export function onboardingHref(step: OnboardingStep): Href {
  return `/onboarding/${step}` as Href;
}

/** Current user's onboarding progress and navigation helpers. */
export function useOnboarding() {
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const progress = useOnboardingStore((s) => s.byUser[userId]);
  const setStep = useOnboardingStore((s) => s.setStep);
  const updateDraftFor = useOnboardingStore((s) => s.updateDraft);
  const setAccountFor = useOnboardingStore((s) => s.setAccount);
  const clearFor = useOnboardingStore((s) => s.clear);

  const advance = useCallback(
    (from: OnboardingStep) => {
      const next = nextStep(from);
      setStep(userId, next);
      router.push(onboardingHref(next));
    },
    [setStep, userId],
  );

  const goBack = useCallback(
    (to: OnboardingStep) => {
      setStep(userId, to);
      if (router.canGoBack()) router.back();
      else router.replace(onboardingHref(to));
    },
    [setStep, userId],
  );

  const updateDraft = useCallback(
    (patch: Partial<OnboardingDraft>) => updateDraftFor(userId, patch),
    [updateDraftFor, userId],
  );

  return {
    userId,
    progress,
    advance,
    goBack,
    updateDraft,
    setAccount: (accountId: string | null) => setAccountFor(userId, accountId),
    clear: () => clearFor(userId),
  };
}
