import type { AuthStorage } from '@/lib/secureChunks';

export type { AuthStorage };

/** Web keeps the session in localStorage. Native uses SecureStore via the .native module. */
const emptyStorage: AuthStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function authStorage(): AuthStorage {
  try {
    const storage = globalThis.localStorage;
    if (
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function' ||
      typeof storage.removeItem !== 'function'
    ) {
      return emptyStorage;
    }
    return storage;
  } catch {
    return emptyStorage;
  }
}
