/**
 * Login copy. A stranger must not learn whether an email or username exists.
 * Wrong password, unknown account, unconfirmed email, and a pending invite
 * that has not accepted a password all share one message.
 * "Not set up" is only for a sign-in that already accepted the password.
 */

export const LOGIN_HONEST = 'That sign-in didn’t work.';
export const LOGIN_RECOVERY = 'Forgot password / use your join link';
export const LOGIN_NOT_SET_UP = 'This account isn’t set up yet. Open your invite, or use your join link.';
export const LOGIN_RATE = 'Too many tries. Wait a few minutes.';
export const LOGIN_OFFLINE = 'No signal. Check you’re online and try again.';

export type LoginCode = 'offline' | 'rate_limited' | 'sign_in_failed' | 'account_not_set_up';

type ErrorFields = {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
};

function fieldsOf(error: unknown): ErrorFields {
  if (!error || typeof error !== 'object') {
    return { message: typeof error === 'string' ? error : '' };
  }
  const row = error as { message?: unknown; status?: unknown; code?: unknown; name?: unknown };
  return {
    message: typeof row.message === 'string' ? row.message : '',
    status: typeof row.status === 'number' ? row.status : undefined,
    code: typeof row.code === 'string' ? row.code : '',
    name: typeof row.name === 'string' ? row.name : '',
  };
}

/** Network and rate-limit only. Every other auth failure is the same code. */
export function loginFailureCode(error: unknown): 'offline' | 'rate_limited' | 'sign_in_failed' {
  const row = fieldsOf(error);
  const message = `${row.message ?? ''} ${row.name ?? ''} ${row.code ?? ''}`.toLowerCase();
  if (
    row.status === 0 ||
    row.name === 'AuthRetryableFetchError' ||
    row.name === 'FunctionsFetchError' ||
    message.includes('failed to fetch') ||
    message.includes('failed to send a request') ||
    message.includes('network request failed') ||
    message.includes('networkerror') ||
    message.includes('internet connection') ||
    message.includes('load failed') ||
    message.includes('timeout') ||
    message.includes('offline')
  ) {
    return 'offline';
  }
  if (
    row.status === 429 ||
    message.includes('rate limit') ||
    message.includes('too many') ||
    message.includes('over_request_rate_limit') ||
    message.includes('over_email_send_rate_limit') ||
    message.includes('only request this')
  ) {
    return 'rate_limited';
  }
  return 'sign_in_failed';
}

export function presentLoginFailure(code: string): { message: string; showRecovery: boolean } {
  if (code === 'account_not_set_up') return { message: LOGIN_NOT_SET_UP, showRecovery: true };
  const kind = code === 'offline' || code === 'rate_limited' || code === 'sign_in_failed' ? code : loginFailureCode({ message: code, code });
  if (kind === 'offline') return { message: LOGIN_OFFLINE, showRecovery: false };
  if (kind === 'rate_limited') return { message: LOGIN_RATE, showRecovery: false };
  return { message: LOGIN_HONEST, showRecovery: true };
}

/**
 * Edge-function failures. Anything other than an explicit rate limit
 * becomes the generic sign-in failure, including a body that names a user.
 */
export async function readLoginFunctionFailure(error: {
  message?: string;
  name?: string;
  context?: unknown;
}): Promise<'offline' | 'rate_limited' | 'sign_in_failed'> {
  if (loginFailureCode(error) === 'offline') return 'offline';
  const context = error.context;
  if (context instanceof Response) {
    if (context.status === 429) return 'rate_limited';
    try {
      const payload = (await context.json()) as { error?: unknown };
      if (payload.error === 'rate_limited') return 'rate_limited';
    } catch {
      if (context.status >= 502) return 'offline';
    }
    return 'sign_in_failed';
  }
  return 'sign_in_failed';
}
