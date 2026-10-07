import { AppError } from '@/lib/errors';
import type { PreferencesRepository } from '@/repositories/types';

import { completionUpdate, type OnboardingDraft } from './model';

/**
 * Writes the onboarding choices and marks onboarding complete, in one
 * synced preferences update (works offline once the row exists locally).
 *
 * The preferences row is created server-side at sign-up; if it has not been
 * pulled yet, one sync is attempted first. If it is still missing (offline),
 * an 'offline' error is raised and the draft stays on the device.
 */
export async function completeOnboarding(
  deps: { preferences: PreferencesRepository; sync: () => Promise<unknown> },
  draft: OnboardingDraft,
  now: string,
): Promise<void> {
  let prefs = await deps.preferences.get();
  if (!prefs) {
    await deps.sync();
    prefs = await deps.preferences.get();
  }
  if (!prefs) throw new AppError('offline', 'Preferences have not synced yet');
  await deps.preferences.update(completionUpdate(draft, now));
}
