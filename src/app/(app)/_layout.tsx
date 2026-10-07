import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, EmptyState, LoadingState, Screen, ToastHost } from '@/components/ui';
import { resolveAppGate } from '@/features/onboarding/model';
import { useOnboardingStore } from '@/features/onboarding/store';
import { usePreferences } from '@/features/settings/hooks/usePreferences';
import { useSyncScheduler } from '@/hooks/useSyncScheduler';
import { DataProvider, useData } from '@/providers/DataProvider';
import { FormatProvider } from '@/providers/FormatProvider';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTheme } from '@/theme';

export const unstable_settings = { initialRouteName: '(tabs)' };

/**
 * Signed-in shell. Mounts the user's local database (DataProvider), the
 * user's formatting (FormatProvider) and the sync scheduler; keyed by user
 * id so switching accounts fully resets state.
 */
export default function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const isSigningOut = useAuthStore((s) => s.isSigningOut);
  if (!user) return null; // guarded by the root navigator; defensive only

  return (
    <DataProvider key={user.id} userId={user.id}>
      <FormatProvider>
        {isSigningOut ? <FullScreenLoading /> : <SyncScheduler />}
        {isSigningOut ? null : <GatedStack />}
        <ToastHost />
      </FormatProvider>
    </DataProvider>
  );
}

function SyncScheduler() {
  useSyncScheduler();
  return null;
}

function FullScreenLoading() {
  return (
    <Screen scroll={false} edges={['top', 'bottom']}>
      <LoadingState />
    </Screen>
  );
}

/** Settles which part of the app the user may see: setup, onboarding or the app. */
function GatedStack() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { syncEngine } = useData();
  const preferences = usePreferences();
  const sync = useSyncStore();
  const authStatus = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id);

  const gate = resolveAppGate({
    preferencesLoading: preferences.isLoading,
    preferences: preferences.data,
    canSyncNow: sync.isOnline && authStatus === 'signed_in',
    firstSyncSettled:
      sync.lastSyncedAt !== null || sync.phase === 'error' || sync.phase === 'offline',
  });

  const hasDraft = useOnboardingStore((s) => (userId ? Boolean(s.byUser[userId]) : false));

  useEffect(() => {
    // Completed elsewhere (e.g. another device): drop any stale local draft.
    if (gate === 'ready' && hasDraft && userId) useOnboardingStore.getState().clear(userId);
  }, [gate, hasDraft, userId]);

  if (preferences.error) {
    return (
      <Screen scroll={false} edges={['top', 'bottom']}>
        <EmptyState icon="alert-circle-outline" title={t('states.errorTitle')} />
        <Button label={t('common.retry')} onPress={() => void preferences.refetch()} />
      </Screen>
    );
  }

  if (gate === 'loading') {
    return (
      <Screen scroll={false} edges={['top', 'bottom']}>
        <LoadingState label={t('gate.settingUpBody')} />
        <Button
          label={t('more.syncNow')}
          variant="ghost"
          size="md"
          onPress={() => void syncEngine.sync().then(() => preferences.refetch())}
        />
      </Screen>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.colors.background },
        animation: theme.reduceMotion ? 'none' : 'default',
      }}
    >
      <Stack.Protected guard={gate === 'onboarding'}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'ready'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="add"
          options={{
            title: t('add.title'),
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.surfaceRaised },
          }}
        />
        <Stack.Screen name="accounts/index" options={{ title: t('accounts.title') }} />
        <Stack.Screen
          name="accounts/new"
          options={{ title: t('accounts.new'), presentation: 'modal' }}
        />
        <Stack.Screen name="accounts/[id]/index" options={{ title: '' }} />
        <Stack.Screen
          name="accounts/[id]/edit"
          options={{ title: t('accounts.editTitle'), presentation: 'modal' }}
        />
        <Stack.Screen name="settings/regional" options={{ title: t('regional.title') }} />
        <Stack.Screen name="settings/privacy" options={{ title: t('privacy.title') }} />
        <Stack.Screen name="settings/about" options={{ title: t('about.title') }} />
      </Stack.Protected>
    </Stack>
  );
}
