import { userCheckOutcome, type UserCheck, type UserCheckError } from '@/lib/sessionBoot';
import { userIdAfterAuthEvent } from '@/lib/signOut';

export type AuthErrorLike = UserCheckError & { message?: string };

export type GetUserRead = 'signed-in' | 'signed-out' | 'network';

export type PersonLoad<T> = { kind: 'person'; person: T | null } | { kind: 'network' };

/** A fetch or transport failure. Never a signed-out answer. */
export function isFetchFailure(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError' || error.name === 'TypeError') return true;
  if (error.status === 0) return true;
  const message = `${error.message ?? ''}`.toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('network request failed') ||
    message.includes('networkerror') ||
    message.includes('load failed') ||
    message.includes('failed to send a request') ||
    message.includes('internet connection') ||
    message.includes('the network connection was lost') ||
    /\btimeout\b/.test(message)
  );
}

/**
 * What getUser means for the signed-in person.
 * Network throws. Null is only a missing session or an auth error that says the user is gone.
 */
export function readGetUser(input: { userId: string | null; error: AuthErrorLike | null }): GetUserRead {
  if (isFetchFailure(input.error)) return 'network';
  if (!input.userId && !input.error) return 'signed-out';
  const outcome = userCheckOutcome(input.error, Boolean(input.userId));
  if (outcome === 'rejected') return 'signed-out';
  if (outcome === 'ok') return 'signed-in';
  return 'network';
}

/** my_person: a transport error throws. A row comes back only when the call reached the server. */
export function readMyPerson<T>(data: T | null, error: AuthErrorLike | null): T | null {
  if (!error) return data ?? null;
  const failure = new Error(error.message || 'Failed to fetch');
  if (isFetchFailure(error)) failure.name = error.name || 'TypeError';
  throw failure;
}

/**
 * The me() decision. A fetch error from getUser throws. A definite signed-out answer is null.
 * The profile call is only made once getUser says the session is still there.
 */
export async function personFromAuthReads<T>(input: {
  userId: string | null;
  userError: AuthErrorLike | null;
  loadPerson: () => Promise<T | null>;
}): Promise<T | null> {
  const read = readGetUser({ userId: input.userId, error: input.userError });
  if (read === 'network') throw new Error(input.userError?.message || 'Failed to fetch');
  if (read === 'signed-out') return null;
  return input.loadPerson();
}

/** A thrown read is a network failure. A returned person, including null, is the server's answer. */
export async function loadPersonKeepingCurrent<T>(load: () => Promise<T | null>): Promise<PersonLoad<T>> {
  try {
    return { kind: 'person', person: await load() };
  } catch {
    return { kind: 'network' };
  }
}

/** Keep the current person when the network failed. Clear only for a definite signed-out answer. */
export function personAfterRefresh<T>(current: T | null, result: PersonLoad<T>): T | null {
  if (result.kind === 'network') return current;
  return result.person;
}

/**
 * Auth events. A SIGNED_OUT that still has a stored session and a network failure
 * is not a sign-out. A rejected session, or a SIGNED_OUT with nothing stored, is.
 */
export function personOnAuthEvent<T extends { auth_user_id?: string | null }>(input: {
  event: string;
  sessionUserId: string | null;
  storedUserId: string | null;
  online: UserCheck;
  current: T | null;
  restored: T | null;
}): T | null {
  if (input.event === 'SIGNED_OUT') {
    if (input.storedUserId && input.online === 'offline') return input.current ?? input.restored;
    return null;
  }
  const userId = userIdAfterAuthEvent(input.event, input.sessionUserId, input.storedUserId);
  if (!userId) return null;
  if (input.online === 'rejected') return null;
  if (input.online === 'offline') return input.current ?? input.restored;
  return input.restored ?? input.current;
}
