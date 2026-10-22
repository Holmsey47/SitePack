/** Who may read the drawing cache, and whether an in-flight download may still write. */

export type CacheSession = {
  generation: number;
  userId: string | null;
  ownerUserId: string | null;
};

export function createCacheSession(): CacheSession {
  return { generation: 1, userId: null, ownerUserId: null };
}

/** Sign-out, expiry, or any other transition to no session. */
export function endCacheSession(session: CacheSession): void {
  session.generation += 1;
  session.userId = null;
  session.ownerUserId = null;
}

export function forgetSessionCache(session: CacheSession, clear: () => void): void {
  endCacheSession(session);
  clear();
}

/**
 * Bind the cache to this user. The same owner is kept.
 * A missing or different owner must be wiped by the caller before finishClaim.
 */
export function claimCacheSession(session: CacheSession, userId: string): 'kept' | 'replaced' {
  if (session.ownerUserId === userId) {
    session.userId = userId;
    return 'kept';
  }
  session.generation += 1;
  session.ownerUserId = null;
  session.userId = userId;
  return 'replaced';
}

/** After the bytes are gone, the empty cache belongs to this user. */
export function finishClaim(session: CacheSession, userId: string, generation: number): boolean {
  if (session.generation !== generation || session.userId !== userId) return false;
  session.ownerUserId = userId;
  return true;
}

export function cacheReadable(session: CacheSession): boolean {
  return Boolean(session.userId) && session.ownerUserId === session.userId;
}

/**
 * A read with no signed-in user returns nothing and leaves the bytes.
 * A missing or different owner does not return the stored value.
 */
export function readOwned<T>(session: CacheSession, load: () => T, empty: T): { value: T; wipe: boolean } {
  if (!session.userId) return { value: empty, wipe: false };
  if (session.ownerUserId !== session.userId) {
    session.generation += 1;
    session.ownerUserId = null;
    return { value: empty, wipe: true };
  }
  return { value: load(), wipe: false };
}

export function writeStillCurrent(
  session: CacheSession,
  startedGeneration: number,
  startedUserId: string | null
): boolean {
  return (
    startedUserId !== null &&
    session.generation === startedGeneration &&
    session.userId === startedUserId &&
    session.ownerUserId === startedUserId
  );
}

export async function writePackFiles<T>(input: {
  allowed: () => boolean;
  items: readonly T[];
  write: (item: T) => Promise<void>;
  discard: (item: T) => Promise<void>;
  commit: () => Promise<void> | void;
}): Promise<'committed' | 'cancelled'> {
  if (!input.allowed()) return 'cancelled';
  for (const item of input.items) {
    if (!input.allowed()) return 'cancelled';
    await input.write(item);
    if (!input.allowed()) {
      try {
        await input.discard(item);
      } catch {
        // The wipe already removed it.
      }
      return 'cancelled';
    }
  }
  if (!input.allowed()) return 'cancelled';
  await input.commit();
  return 'committed';
}
