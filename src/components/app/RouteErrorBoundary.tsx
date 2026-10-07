import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';

import { logger } from '@/services/monitoring/logger';

import { ErrorState, Screen } from '../ui';

/**
 * Rendered by Expo Router when a route throws during render. Reports the
 * error (redacted) and shows a friendly message with a retry — never a stack
 * trace or a blank screen.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    logger.error('Route render error', error);
  }, [error]);

  return (
    <Screen scroll={false} edges={['top', 'bottom']}>
      <ErrorState error={error} onRetry={() => void retry()} />
    </Screen>
  );
}
