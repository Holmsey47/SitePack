import type { AuthStorage } from '@/lib/secureChunks';

export type { AuthStorage };

/** Web keeps the session in localStorage. Native uses SecureStore via the .native module. */
export function authStorage(): AuthStorage {
  const storage = globalThis.localStorage;
  if (!storage) {
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
  return storage;
}
