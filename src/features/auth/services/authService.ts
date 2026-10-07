import {
  type AuthChangeEvent,
  isAuthRetryableFetchError,
  type Session,
  type User,
} from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { AppError, toAppError } from '@/lib/errors';
import { secureStorage } from '@/lib/secureStorage';
import { logger } from '@/services/monitoring/logger';
import { AUTH_STORAGE_KEY, getSupabase } from '@/services/supabase/client';
import { type AuthUser, useAuthStore } from '@/stores/authStore';

/**
 * Authentication service — the only module that talks to Supabase Auth.
 * Screens call these functions (through hooks); they never touch the client.
 *
 * Providers: email/password and Google OAuth (PKCE via the system browser).
 * Adding Apple Sign-In later = one more `signInWith…` function using
 * `signInWithIdToken({ provider: 'apple' })` with expo-apple-authentication.
 */

/** Deep link that OAuth, email confirmation and password reset return to. */
export function authRedirectUrl(): string {
  return Linking.createURL('auth/callback');
}

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at),
  };
}

function handleAuthEvent(event: AuthChangeEvent, session: Session | null): void {
  const store = useAuthStore.getState();
  switch (event) {
    case 'SIGNED_IN':
    case 'TOKEN_REFRESHED':
    case 'USER_UPDATED':
      if (session) store.setSignedIn(toAuthUser(session.user));
      break;
    case 'PASSWORD_RECOVERY':
      if (session) store.setSignedIn(toAuthUser(session.user));
      store.setPasswordRecovery(true);
      break;
    case 'SIGNED_OUT':
      store.setSignedOut();
      break;
    default:
      break; // INITIAL_SESSION is handled by restoreSession()
  }
  logger.setUser(session ? { id: session.user.id } : null);
}

let listening = false;

/**
 * Starts listening to auth changes and restores the persisted session.
 * Safe to call more than once.
 */
export async function initAuth(): Promise<void> {
  const supabase = getSupabase();
  if (!listening) {
    listening = true;
    supabase.auth.onAuthStateChange((event, session) => handleAuthEvent(event, session));
  }
  await restoreSession();
}

/**
 * Restores the session at launch. When the access token has expired and the
 * device is offline, Supabase cannot refresh it but keeps it in storage; in
 * that case the user stays signed in ('offline') with full local access.
 */
export async function restoreSession(): Promise<void> {
  const store = useAuthStore.getState();
  try {
    const { data, error } = await getSupabase().auth.getSession();
    if (data.session) {
      store.setSignedIn(toAuthUser(data.session.user));
      logger.setUser({ id: data.session.user.id });
      return;
    }
    if (error && isAuthRetryableFetchError(error)) {
      const offlineUser = await readPersistedUser();
      if (offlineUser) {
        store.setSignedIn(offlineUser, true);
        return;
      }
    }
    store.setSignedOut();
  } catch (error) {
    logger.error('Session restore failed', error);
    const offlineUser = await readPersistedUser();
    if (offlineUser) store.setSignedIn(offlineUser, true);
    else store.setSignedOut();
  }
}

/** Reads the user id/email from the persisted session without validating tokens. */
async function readPersistedUser(): Promise<AuthUser | null> {
  try {
    const raw = await secureStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: User; refresh_token?: string };
    return parsed.user?.id && parsed.refresh_token ? toAuthUser(parsed.user) : null;
  } catch {
    return null;
  }
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw toAppError(error);
}

/** Returns true when the user must confirm their email before signing in. */
export async function signUpWithEmail(email: string, password: string): Promise<boolean> {
  const { data, error } = await getSupabase().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: authRedirectUrl() },
  });
  if (error) throw toAppError(error);
  return !data.session;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectUrl(),
  });
  if (error) throw toAppError(error);
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error) throw toAppError(error);
  useAuthStore.getState().setPasswordRecovery(false);
}

export async function signInWithGoogle(): Promise<void> {
  const redirectTo = authRedirectUrl();
  const { data, error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw toAppError(error);
  if (!data.url) throw new AppError('unknown', 'OAuth URL missing');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') {
    throw new AppError('auth_cancelled', `OAuth ${result.type}`);
  }
  await completeAuthFromUrl(result.url);
}

/**
 * Finishes an auth flow from a redirect/deep-link URL (OAuth, email
 * confirmation, password recovery) by exchanging the PKCE code.
 */
export async function completeAuthFromUrl(url: string): Promise<void> {
  const { queryParams } = Linking.parse(url);
  const errorCode = queryParams?.error_code ?? queryParams?.error;
  if (errorCode) {
    throw new AppError('unauthorized', `Auth redirect error: ${String(errorCode)}`);
  }
  const code = queryParams?.code;
  if (typeof code !== 'string' || code.length === 0) {
    throw new AppError('unauthorized', 'Auth redirect without code');
  }
  await completeAuthWithCode(code);
}

const codeExchanges = new Map<string, Promise<void>>();

/**
 * Exchanges a PKCE auth code once. On Android the same redirect can arrive
 * both as the browser-session result and as a deep link to /auth/callback;
 * a second exchange of the same code would fail, so concurrent and repeated
 * calls share the first attempt.
 */
export function completeAuthWithCode(code: string): Promise<void> {
  let pending = codeExchanges.get(code);
  if (!pending) {
    pending = getSupabase()
      .auth.exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) throw toAppError(error);
      });
    codeExchanges.set(code, pending);
    pending.catch(() => codeExchanges.delete(code));
  }
  return pending;
}

/**
 * Signs out this device. Works offline: if the server cannot be reached the
 * local session is still removed. Local data cleanup is done by the caller
 * (see useSignOut), which first warns about unsynced changes.
 */
export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut({ scope: 'local' });
  if (error) {
    logger.warn('Remote sign-out failed; clearing local session', { code: toAppError(error).code });
    await secureStorage.removeItem(AUTH_STORAGE_KEY);
    await secureStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`);
  }
  useAuthStore.getState().setSignedOut();
  logger.setUser(null);
}

/**
 * Permanently deletes the account and all server-side data via the
 * `delete-account` Edge Function (service-role work never runs on the client).
 * The caller then wipes local data and signs out (see useSignOut).
 */
export async function deleteAccountRemote(): Promise<void> {
  const { error } = await getSupabase().functions.invoke('delete-account', { method: 'POST' });
  if (error) throw toAppError(error);
}
