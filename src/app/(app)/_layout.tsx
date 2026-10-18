import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, EmptyState, LoadingState, Screen, ToastHost } from '@/components/ui';
import { resolveAppGate } from '@/features/onboarding/model';
import { useOnboardingStore } from '@/features/onboarding/store';
import { usePreferences } from '@/features/settings/hooks/usePreferences';
import { useRateRefresh } from '@/features/exchangeRates/useRateRefresh';
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
  useRateRefresh();
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
    // Latched (see syncStore): a new sync starting must not send an
    // onboarding user back to the loading screen and unmount their progress.
    firstSyncSettled: sync.hasSettled,
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
        <Stack.Screen
          name="transactions/new"
          options={{ title: t('transactions.newTitle.expense'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="transactions/[id]/index"
          options={{ title: t('transactions.detailTitle') }}
        />
        <Stack.Screen
          name="transactions/[id]/edit"
          options={{ title: t('transactions.editTitle'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="transactions/filters"
          options={{ title: t('filters.title'), presentation: 'modal' }}
        />
        <Stack.Screen name="categories/index" options={{ title: t('categories.title') }} />
        <Stack.Screen
          name="categories/new"
          options={{ title: t('categories.new'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="categories/[id]/edit"
          options={{ title: t('categories.editTitle'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="budgets/new"
          options={{ title: t('budgets.new'), presentation: 'modal' }}
        />
        <Stack.Screen name="budgets/[id]/index" options={{ title: t('budgets.detailTitle') }} />
        <Stack.Screen
          name="budgets/[id]/edit"
          options={{ title: t('budgets.editTitle'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="budgets/[id]/transactions"
          options={{ title: t('budgets.detail.transactionsTitle') }}
        />
        <Stack.Screen
          name="bills/new"
          options={{ title: t('bills.newBill'), presentation: 'modal' }}
        />
        <Stack.Screen name="bills/[id]/index" options={{ title: t('bills.detailTitle') }} />
        <Stack.Screen
          name="bills/[id]/edit"
          options={{ title: t('bills.editBill'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="bills/[id]/pay"
          options={{ title: t('bills.pay.title'), presentation: 'modal' }}
        />
        <Stack.Screen name="goals/new" options={{ title: t('goals.new'), presentation: 'modal' }} />
        <Stack.Screen name="goals/[id]/index" options={{ title: t('goals.detailTitle') }} />
        <Stack.Screen
          name="goals/[id]/edit"
          options={{ title: t('goals.editTitle'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="goals/[id]/contribute"
          options={{ title: t('goals.contribution.add'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="settings/exchange-rates"
          options={{ title: t('exchangeRates.title') }}
        />
        <Stack.Screen
          name="settings/manual-rate"
          options={{ title: t('exchangeRates.manual.title'), presentation: 'modal' }}
        />
        <Stack.Screen name="data/import" options={{ title: t('dataImport.title') }} />
        <Stack.Screen name="data/export" options={{ title: t('dataExport.title') }} />
        <Stack.Screen
          name="reports/categories"
          options={{ title: t('reports.sections.categories') }}
        />
        <Stack.Screen
          name="reports/merchants"
          options={{ title: t('reports.sections.merchants') }}
        />
        <Stack.Screen name="reports/balances" options={{ title: t('reports.sections.balances') }} />
        <Stack.Screen name="reports/transactions" options={{ title: t('reports.lines.title') }} />
        <Stack.Screen name="settings/regional" options={{ title: t('regional.title') }} />
        <Stack.Screen name="settings/privacy" options={{ title: t('privacy.title') }} />
        <Stack.Screen name="settings/about" options={{ title: t('about.title') }} />
      </Stack.Protected>
    </Stack>
  );
}
