import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, EmptyState, LoadingState, Screen } from '@/components/ui';
import { completeAuthWithCode } from '@/features/auth/services/authService';
import { logger } from '@/services/monitoring/logger';
import { selectIsAuthenticated, useAuthStore } from '@/stores/authStore';

/**
 * Landing route for auth deep links (moneymanager://auth/callback?code=…).
 * Exchanges the PKCE code, then hands control back to the guarded navigator.
 */
export default function AuthCallbackScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string; error?: string; error_code?: string }>();
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const [exchangeFailed, setExchangeFailed] = useState(false);

  const code = params.error || params.error_code ? undefined : params.code;
  const failed = exchangeFailed || (!code && !isAuthenticated);

  useEffect(() => {
    if (!code) {
      if (isAuthenticated) router.replace('/');
      return;
    }
    completeAuthWithCode(code)
      .then(() => router.replace('/'))
      .catch(() => {
        logger.warn('Auth callback code exchange failed');
        // The code may already have been used by the in-app browser session.
        if (useAuthStore.getState().status === 'signed_in') router.replace('/');
        else setExchangeFailed(true);
      });
  }, [code, isAuthenticated]);

  if (!failed) {
    return (
      <Screen scroll={false} edges={['top', 'bottom']}>
        <LoadingState label={t('auth.completingSignIn')} />
      </Screen>
    );
  }
  return (
    <Screen scroll={false} edges={['top', 'bottom']}>
      <EmptyState icon="link-outline" title={t('auth.linkInvalid')} />
      <Button label={t('auth.backToSignIn')} onPress={() => router.replace('/')} />
    </Screen>
  );
}
