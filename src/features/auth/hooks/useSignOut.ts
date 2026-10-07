import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

import { logger } from '@/services/monitoring/logger';
import { useData } from '@/providers/DataProvider';
import { useOnboardingStore } from '@/features/onboarding/store';
import { useAuthStore } from '@/stores/authStore';

import { deleteAccountRemote, signOut } from '../services/authService';

/**
 * Sign-out removes this user's local database from the device. If changes
 * have not synced yet, the user is warned first, because they would be lost.
 */
export function useSignOut() {
  const { t } = useTranslation();
  const { syncEngine, destroyLocalData } = useData();
  const [busy, setBusy] = useState(false);

  /**
   * Order matters: wipe local data first while screens show a loader
   * (isSigningOut), THEN end the session — ending it first would unmount the
   * data layer mid-deletion. signOut() never fails: it clears the local
   * session even when offline.
   */
  const perform = useCallback(
    async (beforeWipe?: () => Promise<void>) => {
      setBusy(true);
      const store = useAuthStore.getState();
      store.setSigningOut(true);
      try {
        await beforeWipe?.();
        await destroyLocalData();
        // Per-user onboarding draft goes with the user's data; device-level
        // settings (theme) are kept.
        const userId = store.user?.id;
        if (userId) useOnboardingStore.getState().clear(userId);
        await signOut();
      } catch (error) {
        logger.error('Sign-out failed', error);
        store.setSigningOut(false);
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [destroyLocalData],
  );

  const confirmIfUnsynced = useCallback(
    async (onConfirm: () => void) => {
      await syncEngine.refreshCounts();
      const { pendingCount, failedCount } = syncEngine.getStatus();
      const unsynced = pendingCount + failedCount;
      if (unsynced === 0) {
        onConfirm();
        return;
      }
      Alert.alert(
        t('auth.signOutUnsyncedTitle'),
        t('auth.signOutUnsyncedBody', { count: unsynced }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('auth.signOutAnyway'), style: 'destructive', onPress: onConfirm },
        ],
      );
    },
    [syncEngine, t],
  );

  const requestSignOut = useCallback(
    () => confirmIfUnsynced(() => void perform().catch(() => undefined)),
    [confirmIfUnsynced, perform],
  );

  /** Server deletion runs first; if it fails, nothing local is touched. */
  const requestDeleteAccount = useCallback(
    (onError: (error: unknown) => void) =>
      perform(deleteAccountRemote).catch((error: unknown) => onError(error)),
    [perform],
  );

  return { requestSignOut, requestDeleteAccount, busy };
}
