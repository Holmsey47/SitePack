export type AuthStorage = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

/** Under the 2048-byte SecureStore value limit, with room for UTF-8. */
export const SECURE_CHUNK_BYTES = 1800;

const MAX_CHUNKS = 16;

export function splitSecureValue(value: string, maxBytes = SECURE_CHUNK_BYTES): string[] {
  if (maxBytes < 4) throw new Error('SecureStore chunk size is too small.');
  if (value.length === 0) return [''];
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (size > maxBytes) throw new Error('A single character does not fit in a SecureStore chunk.');
    if (bytes + size > maxBytes) {
      chunks.push(current);
      current = char;
      bytes = size;
    } else {
      current += char;
      bytes += size;
    }
  }
  chunks.push(current);
  if (chunks.length > MAX_CHUNKS) throw new Error('Session is too large for SecureStore.');
  return chunks;
}

export function joinSecureChunks(chunks: readonly string[]): string {
  return chunks.join('');
}

/** SecureStore keys are alphanumeric plus `.`, `-`, and `_`. */
export function secureStoreKey(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'sitepack_session';
}

export function secureChunkCountKey(key: string): string {
  return `${secureStoreKey(key)}.count`;
}

export function secureChunkKey(key: string, index: number): string {
  return `${secureStoreKey(key)}.${index}`;
}

export const SECURE_CHUNK_CAP = MAX_CHUNKS;
