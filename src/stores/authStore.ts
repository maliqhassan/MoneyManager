import { create } from 'zustand';

/**
 * Authentication state shared across the app. Populated by the auth service
 * (features/auth/services/authService.ts) from Supabase auth events.
 *
 * Holds only what navigation and UI need — never tokens.
 *
 * status:
 *  - 'initializing'  : reading the persisted session at launch
 *  - 'signed_out'    : no session
 *  - 'signed_in'     : valid session
 *  - 'offline'       : a persisted session exists but could not be refreshed
 *                      because the device is offline. The user keeps full
 *                      access to local data; sync resumes when online.
 */
export type AuthStatus = 'initializing' | 'signed_out' | 'signed_in' | 'offline';

export interface AuthUser {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** True after a password-recovery link was opened; routes to "set new password". */
  isPasswordRecovery: boolean;
  /** True while local data is being wiped during sign-out / account deletion. */
  isSigningOut: boolean;
  setSignedIn: (user: AuthUser, offline?: boolean) => void;
  setSignedOut: () => void;
  setPasswordRecovery: (value: boolean) => void;
  setSigningOut: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'initializing',
  user: null,
  isPasswordRecovery: false,
  isSigningOut: false,
  setSignedIn: (user, offline = false) => set({ user, status: offline ? 'offline' : 'signed_in' }),
  setSignedOut: () =>
    set({ user: null, status: 'signed_out', isPasswordRecovery: false, isSigningOut: false }),
  setPasswordRecovery: (isPasswordRecovery) => set({ isPasswordRecovery }),
  setSigningOut: (isSigningOut) => set({ isSigningOut }),
}));

export const selectIsAuthenticated = (s: AuthState) =>
  s.status === 'signed_in' || s.status === 'offline';
