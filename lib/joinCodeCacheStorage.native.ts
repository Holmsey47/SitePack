import * as SecureStore from 'expo-secure-store';

import { JOIN_CODE_CACHE_KEY, type JoinCodeCachePort } from '@/lib/joinCodeCache';

/** This phone. SecureStore survives closing the app. Sign-out deletes the blob. */
export function joinCodeCachePort(): JoinCodeCachePort {
  return {
    async read() {
      try {
        return await SecureStore.getItemAsync(JOIN_CODE_CACHE_KEY);
      } catch {
        return null;
      }
    },
    async write(value) {
      try {
        await SecureStore.setItemAsync(JOIN_CODE_CACHE_KEY, value);
      } catch {
        // This visit still shows the code.
      }
    },
    async remove() {
      try {
        await SecureStore.deleteItemAsync(JOIN_CODE_CACHE_KEY);
      } catch {
        // Already gone.
      }
    },
  };
}
