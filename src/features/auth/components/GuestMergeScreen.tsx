import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, ErrorState, Icon, LoadingState, Screen, Text } from '@/components/ui';
import { deleteUserDatabase, openUserDatabase } from '@/database/openDatabase';
import { useOnboardingStore } from '@/features/onboarding/store';
import { newId, nowIso } from '@/lib/ids';
import { useData } from '@/providers/DataProvider';
import { logger } from '@/services/monitoring/logger';
import { useAuthStore } from '@/stores/authStore';
import { useLocalModeStore } from '@/stores/localModeStore';
import { mergeGuestData } from '@/sync/guestMerge';
import { makeStyles } from '@/theme';

import { useSignOut } from '../hooks/useSignOut';

/** Tables the merge matches against, so defaults are not duplicated. */
const MATCH_TABLES = ['user_preferences', 'categories', 'tags', 'merchants'] as const;

/**
 * Shown once, right after a local-only user signs in: their device data is
 * merged into the account (sync/guestMerge.ts) before the app opens. If it
 * fails nothing is lost — the local data stays as it was and can be retried
 * (or the user signs out and keeps using it without an account).
 */
export function GuestMergeScreen({ guestId }: { guestId: string }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const queryClient = useQueryClient();
  const { db, syncEngine } = useData();
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const { requestSignOut } = useSignOut();

  const merge = useQuery({
    queryKey: ['guest-merge', guestId, userId],
    enabled: userId !== '',
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    networkMode: 'always',
    queryFn: async () => {
      try {
        await syncEngine.pullOnly(MATCH_TABLES);
        const local = await openUserDatabase(guestId);
        try {
          await mergeGuestData({
            source: local.db,
            target: db,
            guestId,
            userId,
            newId,
            now: nowIso,
          });
        } finally {
          await local.close();
        }
      } catch (e) {
        logger.error('Moving local data to the account failed', e);
        throw e;
      }
      await deleteUserDatabase(guestId).catch((e: unknown) =>
        logger.warn('Local-only database not deleted', { code: String(e) }),
      );
      useOnboardingStore.getState().clear(guestId);
      await syncEngine.refreshCounts();
      void queryClient.invalidateQueries();
      // Unmounts this screen; the app opens with the merged data and syncs it.
      useLocalModeStore.getState().clearGuest();
      return true;
    },
  });

  if (merge.error) {
    return (
      <Screen scroll={false} edges={['top', 'bottom']}>
        <ErrorState
          title={t('guestMerge.errorTitle')}
          error={merge.error}
          onRetry={() => void merge.refetch()}
        />
        <Text variant="bodySmall" tone="textSecondary" align="center">
          {t('guestMerge.errorBody')}
        </Text>
        <Button
          label={t('auth.signOut')}
          variant="ghost"
          size="md"
          onPress={() => void requestSignOut()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.icon}>
          <Icon name="cloud-upload-outline" size={32} tone="primary" />
        </View>
        <LoadingState label={t('guestMerge.working')} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: t.colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
