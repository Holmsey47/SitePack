import { JOIN_CODE_CACHE_KEY, type JoinCodeCachePort } from '@/lib/joinCodeCache';

function sessionStore(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    const storage = globalThis.sessionStorage;
    if (
      storage == null ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function' ||
      typeof storage.removeItem !== 'function'
    ) {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}

/** This browser tab. A new tab has no plaintext, so it shows the other-device state. A refresh keeps it. */
export function joinCodeCachePort(): JoinCodeCachePort {
  return {
    async read() {
      try {
        return sessionStore()?.getItem(JOIN_CODE_CACHE_KEY) ?? null;
      } catch {
        return null;
      }
    },
    async write(value) {
      try {
        sessionStore()?.setItem(JOIN_CODE_CACHE_KEY, value);
      } catch {
        // The code stays on screen for this visit.
      }
    },
    async remove() {
      try {
        sessionStore()?.removeItem(JOIN_CODE_CACHE_KEY);
      } catch {
        // Sign-out still continues.
      }
    },
  };
}
