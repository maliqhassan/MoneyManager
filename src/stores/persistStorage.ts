import Storage from 'expo-sqlite/kv-store';
import type { StateStorage } from 'zustand/middleware';

/**
 * Synchronous key-value storage for small, NON-sensitive device settings
 * (theme, UI flags). Synchronous reads mean persisted state is available on
 * the very first render — no flash of the wrong theme.
 *
 * Never store tokens or financial data here: use SecureStore (lib/secureStorage)
 * for secrets and the SQLite repositories for financial records.
 */
export const devicePersistStorage: StateStorage = {
  getItem: (name) => Storage.getItemSync(name),
  setItem: (name, value) => Storage.setItemSync(name, value),
  removeItem: (name) => {
    Storage.removeItemSync(name);
  },
};
