/** localStorage when it actually has the Storage methods. A bare `window` on native does not. */
export function usableLocalStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
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
