import type { AuthStorage } from '@/lib/secureChunks';
import { authStorage } from '@/lib/secureSession';

/** Signed-out people land on the login form. Welcome and start stay public too. */
export const SIGN_IN_HREF = '/login' as const;

export function authTokenStorageKey(supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''): string | null {
  try {
    const host = new URL(supabaseUrl).hostname.split('.')[0];
    return host ? `sb-${host}-auth-token` : null;
  } catch {
    return null;
  }
}

/**
 * A SIGNED_OUT event has no session on purpose. Do not fill that in from storage.
 * Other events may still fall back to the stored token when an offline refresh drops getSession().
 */
export function userIdAfterAuthEvent(
  event: string,
  sessionUserId: string | null,
  storedUserId: string | null
): string | null {
  if (event === 'SIGNED_OUT') return null;
  return sessionUserId ?? storedUserId;
}

export async function removeAuthSessionKeys(storage: AuthStorage, storageKey: string | null): Promise<void> {
  if (!storageKey) return;
  await storage.removeItem(storageKey);
  await storage.removeItem(`${storageKey}-user`);
  await storage.removeItem(`${storageKey}-code-verifier`);
}

/** Drop the sb-* session from web localStorage or the native SecureStore chunks. */
export async function removeStoredAuthSession(): Promise<void> {
  await removeAuthSessionKeys(authStorage(), authTokenStorageKey());
}

/**
 * Await a local sign-out, then drop the stored session and the app cache anyway.
 * A network failure must not leave the sb-* key or skip the login route.
 */
export async function performSignOut(deps: {
  signOutLocal: () => Promise<void>;
  clearStoredSession: () => Promise<void>;
  clearAppCache: () => Promise<void>;
}): Promise<typeof SIGN_IN_HREF> {
  try {
    await deps.signOutLocal();
  } catch {
    // The storage wipe below is what actually ends the session.
  }
  await deps.clearStoredSession();
  await deps.clearAppCache();
  return SIGN_IN_HREF;
}
