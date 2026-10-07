import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { devicePersistStorage } from '@/stores/persistStorage';

import type { OnboardingDraft, OnboardingStep } from './model';

/**
 * In-progress onboarding, persisted on the device per user so closing the
 * app resumes at the same step. This is the ONLY place onboarding progress
 * lives; *completion* is stored once, in the synced user_preferences row
 * (onboarding_completed_at), so it follows the user to other devices.
 *
 * Contains no financial data (the first account is a normal synced record;
 * only its id is remembered). Cleared on completion and on sign-out.
 */
export interface OnboardingProgress {
  step: OnboardingStep;
  draft: OnboardingDraft;
  /** Account created during onboarding, so going back never creates a duplicate. */
  accountId: string | null;
}

export interface OnboardingState {
  byUser: Record<string, OnboardingProgress>;
  /** Starts (or keeps) progress for a user, seeded with suggestions. */
  ensure: (userId: string, suggestion: OnboardingDraft) => OnboardingProgress;
  setStep: (userId: string, step: OnboardingStep) => void;
  updateDraft: (userId: string, patch: Partial<OnboardingDraft>) => void;
  setAccount: (userId: string, accountId: string | null) => void;
  clear: (userId: string) => void;
}

export function createOnboardingStore(storage: StateStorage) {
  return create<OnboardingState>()(
    persist(
      (set, get) => {
        const patch = (userId: string, change: Partial<OnboardingProgress>) => {
          const current = get().byUser[userId];
          if (!current) return;
          set({ byUser: { ...get().byUser, [userId]: { ...current, ...change } } });
        };
        return {
          byUser: {},
          ensure: (userId, suggestion) => {
            const existing = get().byUser[userId];
            if (existing) return existing;
            const fresh: OnboardingProgress = {
              step: 'welcome',
              draft: suggestion,
              accountId: null,
            };
            set({ byUser: { ...get().byUser, [userId]: fresh } });
            return fresh;
          },
          setStep: (userId, step) => patch(userId, { step }),
          updateDraft: (userId, change) => {
            const current = get().byUser[userId];
            if (current) patch(userId, { draft: { ...current.draft, ...change } });
          },
          setAccount: (userId, accountId) => patch(userId, { accountId }),
          clear: (userId) => {
            const { [userId]: _removed, ...rest } = get().byUser;
            set({ byUser: rest });
          },
        };
      },
      {
        name: 'onboarding.v1',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: ({ byUser }) => ({ byUser }),
      },
    ),
  );
}

export const useOnboardingStore = createOnboardingStore(devicePersistStorage);
