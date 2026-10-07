import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { ConfigErrorScreen } from '@/components/app/ConfigErrorScreen';
import { envResult } from '@/config/env';
import { initAuth } from '@/features/auth/services/authService';
import { AppProviders } from '@/providers/AppProviders';
import { logger } from '@/services/monitoring/logger';
import { selectIsAuthenticated, useAuthStore } from '@/stores/authStore';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/app/RouteErrorBoundary';

// Keep the native splash visible until the persisted session has been read.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  if (!envResult.ok) {
    return (
      <AppProviders>
        <HideSplash />
        <ConfigErrorScreen issues={envResult.issues} />
      </AppProviders>
    );
  }
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}

function HideSplash() {
  useEffect(() => {
    SplashScreen.hide();
  }, []);
  return null;
}

/**
 * Route groups are guarded declaratively: only the stack matching the auth
 * state exists, so signed-out users cannot reach (app) routes even via deep
 * links, and signed-in users never see the auth screens.
 */
function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const isPasswordRecovery = useAuthStore((s) => s.isPasswordRecovery);

  useEffect(() => {
    initAuth().catch((error: unknown) => {
      logger.error('Auth initialisation failed', error);
      useAuthStore.getState().setSignedOut();
    });
  }, []);

  useEffect(() => {
    if (status !== 'initializing') SplashScreen.hide();
  }, [status]);

  if (status === 'initializing') return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated && !isPasswordRecovery}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={isAuthenticated && isPasswordRecovery}>
        <Stack.Screen name="reset-password" />
      </Stack.Protected>
      {/* Deep-link target for OAuth, email confirmation and password reset. */}
      <Stack.Screen name="auth/callback" />
    </Stack>
  );
}
