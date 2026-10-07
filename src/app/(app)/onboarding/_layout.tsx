import { Stack } from 'expo-router';
import { useEffect, useMemo } from 'react';

import { draftFormatSettings, suggestDraft } from '@/features/onboarding/model';
import { useOnboardingStore } from '@/features/onboarding/store';
import { FormatContext } from '@/i18n/FormatContext';
import { createFormatter } from '@/i18n/formatter';
import { deviceFormatSettings } from '@/i18n/locale';
import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/theme';

/**
 * Onboarding flow. Progress is persisted per user (resumes after restart).
 * While onboarding, formatting follows the user's *draft* choices so
 * previews and amount entry match what they just picked.
 */
export default function OnboardingLayout() {
  const theme = useTheme();
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const progress = useOnboardingStore((s) => s.byUser[userId]);
  const ensure = useOnboardingStore((s) => s.ensure);

  useEffect(() => {
    if (userId) ensure(userId, suggestDraft(deviceFormatSettings()));
  }, [ensure, userId]);

  const formatter = useMemo(
    () => (progress ? createFormatter(draftFormatSettings(progress.draft)) : null),
    [progress],
  );

  if (!progress || !formatter) return null;

  return (
    <FormatContext.Provider value={formatter}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: theme.reduceMotion ? 'none' : 'slide_from_right',
        }}
      />
    </FormatContext.Provider>
  );
}
