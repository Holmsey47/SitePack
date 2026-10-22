import * as SecureStore from 'expo-secure-store';

import {
  SECURE_CHUNK_CAP,
  joinSecureChunks,
  secureChunkCountKey,
  secureChunkKey,
  splitSecureValue,
  type AuthStorage,
} from '@/lib/secureChunks';

async function readLegacyLocal(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

async function clearLegacyLocal(key: string): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // The secure copy is the one that counts.
  }
}

async function clearChunks(key: string, count: number): Promise<void> {
  const limit = Math.min(Math.max(count, 0), SECURE_CHUNK_CAP);
  await SecureStore.deleteItemAsync(secureChunkCountKey(key)).catch(() => undefined);
  for (let index = 0; index < limit; index += 1) {
    await SecureStore.deleteItemAsync(secureChunkKey(key, index)).catch(() => undefined);
  }
}

/** Session tokens on Android and iOS. Values are chunked under the 2048-byte limit. */
export function authStorage(): AuthStorage {
  return {
    async getItem(key) {
      const countRaw = await SecureStore.getItemAsync(secureChunkCountKey(key));
      const count = countRaw == null ? 0 : Number(countRaw);
      if (Number.isInteger(count) && count > 0 && count <= SECURE_CHUNK_CAP) {
        const parts: string[] = [];
        for (let index = 0; index < count; index += 1) {
          const part = await SecureStore.getItemAsync(secureChunkKey(key, index));
          if (part == null) return null;
          parts.push(part);
        }
        return joinSecureChunks(parts);
      }
      const legacy = await readLegacyLocal(key);
      if (legacy == null) return null;
      await this.setItem(key, legacy);
      await clearLegacyLocal(key);
      return legacy;
    },
    async setItem(key, value) {
      const chunks = splitSecureValue(value);
      const previousRaw = await SecureStore.getItemAsync(secureChunkCountKey(key));
      const previous = previousRaw == null ? 0 : Number(previousRaw);
      for (let index = 0; index < chunks.length; index += 1) {
        await SecureStore.setItemAsync(secureChunkKey(key, index), chunks[index] ?? '');
      }
      if (Number.isInteger(previous) && previous > chunks.length) {
        for (let index = chunks.length; index < Math.min(previous, SECURE_CHUNK_CAP); index += 1) {
          await SecureStore.deleteItemAsync(secureChunkKey(key, index));
        }
      }
      await SecureStore.setItemAsync(secureChunkCountKey(key), String(chunks.length));
      await clearLegacyLocal(key);
    },
    async removeItem(key) {
      const previousRaw = await SecureStore.getItemAsync(secureChunkCountKey(key));
      const previous = previousRaw == null ? 0 : Number(previousRaw);
      await clearChunks(key, Number.isInteger(previous) ? previous : SECURE_CHUNK_CAP);
      await clearLegacyLocal(key);
    },
  };
}
