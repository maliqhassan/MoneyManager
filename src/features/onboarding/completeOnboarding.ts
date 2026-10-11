import { AppError, type ErrorCode } from '@/lib/errors';
import type { PreferencesRepository } from '@/repositories/types';

import { completionUpdate, type OnboardingDraft } from './model';

/** Longest the "Start" button waits for a sync before reporting a timeout. */
export const COMPLETION_SYNC_TIMEOUT_MS = 30_000;

export interface CompletionDeps {
  preferences: PreferencesRepository;
  /** One sync run; resolves with its outcome (never rejects in practice). */
  sync: () => Promise<{ errorCode: ErrorCode | null }>;
  timeoutMs?: number;
}

/** Why the preferences row is still missing after a sync attempt. */
function missingPreferencesError(syncError: ErrorCode | null): AppError {
  switch (syncError) {
    case 'network':
    case 'offline':
      return new AppError('offline', 'Preferences have not synced yet (offline)');
    case 'timeout':
      return new AppError('timeout', 'Sync did not finish in time');
    case 'unauthorized':
      return new AppError('unauthorized', 'Session expired; sign in again');
    default:
      // Sync ran (or failed on the server side) but the server has not
      // created this user's preferences: its database is not set up yet.
      return new AppError('server_not_ready', 'Server has not created user preferences');
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Writes the onboarding choices and marks onboarding complete, in one synced
 * preferences update (works offline once the row exists locally).
 *
 * The preferences row is created SERVER-side at sign-up (never by the device,
 * so several devices can't create conflicting rows). If it has not reached
 * this device yet, one sync is attempted first. If it is still missing, a
 * specific error explains why (offline, timeout, expired session, or server
 * not set up). The draft and the first account stay on the device either
 * way; tapping again retries. The update itself is idempotent, so repeated
 * attempts never create duplicates.
 */
export async function completeOnboarding(
  deps: CompletionDeps,
  draft: OnboardingDraft,
  now: string,
): Promise<void> {
  let prefs = await deps.preferences.get();
  if (!prefs) {
    const outcome = await withTimeout(deps.sync(), deps.timeoutMs ?? COMPLETION_SYNC_TIMEOUT_MS);
    prefs = await deps.preferences.get();
    if (!prefs) {
      throw missingPreferencesError(outcome === 'timeout' ? 'timeout' : outcome.errorCode);
    }
  }
  await deps.preferences.update(completionUpdate(draft, now));
}
