import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { LoadingState, Screen } from '@/components/ui';
import { useSyncScheduler } from '@/hooks/useSyncScheduler';
import { DataProvider } from '@/providers/DataProvider';
import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/theme';

export const unstable_settings = { initialRouteName: '(tabs)' };

/**
 * Signed-in shell. Mounts the user's local database (DataProvider) and the
 * sync scheduler; keyed by user id so switching accounts fully resets state.
 */
export default function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const isSigningOut = useAuthStore((s) => s.isSigningOut);
  if (!user) return null; // guarded by the root navigator; defensive only

  return (
    <DataProvider key={user.id} userId={user.id}>
      {isSigningOut ? <SigningOut /> : <AppStack />}
    </DataProvider>
  );
}

function SigningOut() {
  return (
    <Screen scroll={false} edges={['top', 'bottom']}>
      <LoadingState />
    </Screen>
  );
}

function AppStack() {
  useSyncScheduler();
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
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
    </Stack>
  );
}
