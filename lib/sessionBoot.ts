/** Cold start: wipe the drawing cache only when no session is stored, or the server rejected it. */

export type UserCheckError = {
  name?: string;
  status?: number;
  code?: string;
};

export type UserCheck = 'ok' | 'offline' | 'rejected';

const REJECTED_CODES = new Set([
  'session_not_found',
  'bad_jwt',
  'user_not_found',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_expired',
  'user_banned',
]);

/** Network failures stay offline. Invalid or revoked sessions are rejections. */
export function userCheckOutcome(error: UserCheckError | null, hasUser: boolean): UserCheck {
  if (hasUser && !isAuthRejection(error)) return 'ok';
  if (isAuthRejection(error)) return 'rejected';
  return 'offline';
}

function isAuthRejection(error: UserCheckError | null): boolean {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return false;
  if (error.name === 'AuthSessionMissingError') return true;
  if (error.code && REJECTED_CODES.has(error.code)) return true;
  const status = error.status ?? 0;
  return status === 401 || status === 403;
}

export function userIdFromStoredSession(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { user?: { id?: unknown } };
    const id = parsed.user?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * No stored session wipes. A stored session whose online check failed open keeps that user id.
 * A rejection wipes, the same as a cleared session.
 */
export function coldStartCache(
  storedUserId: string | null,
  online: UserCheck
): { wipe: boolean; userId: string | null } {
  if (!storedUserId || online === 'rejected') return { wipe: true, userId: null };
  return { wipe: false, userId: storedUserId };
}
