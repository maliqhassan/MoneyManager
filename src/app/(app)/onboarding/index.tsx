import { Redirect } from 'expo-router';

import { onboardingHref, useOnboarding } from '@/features/onboarding/useOnboarding';

/** Entry point: resumes at the step the user last reached. */
export default function OnboardingIndex() {
  const { progress } = useOnboarding();
  return <Redirect href={onboardingHref(progress?.step ?? 'welcome')} />;
}
