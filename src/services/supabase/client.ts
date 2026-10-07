import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { getEnv } from '@/config/env';
import { secureStorage } from '@/lib/secureStorage';

/** Fixed key so the persisted session can be inspected offline (see authService). */
export const AUTH_STORAGE_KEY = 'finance.auth.session';

let client: SupabaseClient | null = null;
let appStateSubscription: NativeEventSubscription | null = null;

/**
 * Lazily-created Supabase client. Created on first use (after the root
 * layout validated the environment), never at import time, so a missing
 * configuration produces a friendly screen instead of a crash.
 *
 * The publishable key is not a secret — Row Level Security protects data.
 *
 * TODO(types): once the Supabase project exists, run `npm run supabase:types`
 * and parametrise the client with the generated `Database` type.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const env = getEnv();

  client = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      storage: secureStorage,
      storageKey: AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // PKCE: OAuth and email links return a one-time code exchanged in-app,
      // so tokens never appear in redirect URLs.
      flowType: 'pkce',
    },
    global: {
      headers: { 'x-client-info': 'budgettracker-mobile' },
    },
  });

  // Refresh tokens only while the app is in the foreground.
  appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') void client?.auth.startAutoRefresh();
    else void client?.auth.stopAutoRefresh();
  });

  return client;
}

/** For tests only. */
export function resetSupabaseForTests(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
  client = null;
}
