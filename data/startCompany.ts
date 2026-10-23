export const CHECK_YOUR_EMAIL = 'Check your email';

/** Attempts that count toward the email hash, per hour. */
export const START_EMAIL_LIMIT = 3;

/** Attempts that count toward a known IP hash, per hour. Unknown IPs are not counted. */
export const START_IP_LIMIT = 8;

export const START_WINDOW_MINUTES = 60;

export type StartCompanyInput = {
  companyName: string;
  fullName: string;
  email: string;
};

export type ParsedStartCompany =
  | { ok: true; companyName: string; fullName: string; email: string }
  | { ok: false };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Company name and full name are trimmed and must be 1–80 characters. Email is trimmed and lowercased. */
export function parseStartCompany(input: {
  companyName?: unknown;
  fullName?: unknown;
  email?: unknown;
}): ParsedStartCompany {
  if (typeof input.companyName !== 'string' || typeof input.fullName !== 'string' || typeof input.email !== 'string') {
    return { ok: false };
  }
  const companyName = input.companyName.trim();
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (companyName.length < 1 || companyName.length > 80) return { ok: false };
  if (fullName.length < 1 || fullName.length > 80) return { ok: false };
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false };
  return { ok: true, companyName, fullName, email };
}

export type StartCompanyResult = {
  status: number;
  body: { ok: true; message: typeof CHECK_YOUR_EMAIL } | { error: 'invalid_input' | 'rate_limited' | 'start_failed' };
  deleteUser: boolean;
};

/**
 * The HTTP result for one start attempt.
 * An email that already has an account gets the same 200 as a new invite.
 * The invited user is deleted only when this request created them and the company row did not stick.
 */
export function startCompanyResult(input: {
  valid: boolean;
  limited: boolean;
  invite: 'created' | 'exists' | 'failed' | 'skipped';
  bootstrap: 'ok' | 'already_has_person' | 'failed' | 'skipped';
}): StartCompanyResult {
  if (!input.valid) return { status: 400, body: { error: 'invalid_input' }, deleteUser: false };
  if (input.limited) return { status: 429, body: { error: 'rate_limited' }, deleteUser: false };
  if (input.invite === 'exists' || input.bootstrap === 'already_has_person') {
    return { status: 200, body: { ok: true, message: CHECK_YOUR_EMAIL }, deleteUser: false };
  }
  if (input.invite !== 'created' || input.bootstrap !== 'ok') {
    return {
      status: 500,
      body: { error: 'start_failed' },
      deleteUser: input.invite === 'created' && input.bootstrap === 'failed',
    };
  }
  return { status: 200, body: { ok: true, message: CHECK_YOUR_EMAIL }, deleteUser: false };
}

export function startFailureMessage(code: string): string {
  if (code === 'invalid_input') return 'Enter a company name, your name, and an email.';
  if (code === 'rate_limited') return 'Too many tries. Wait a few minutes.';
  return 'Could not start the company. Try again.';
}

/** Invite errors that mean the address already has a login. The caller still says to check email. */
export function inviteIsExistingAccount(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const row = error as { message?: unknown; code?: unknown };
  const message = typeof row.message === 'string' ? row.message : '';
  const code = typeof row.code === 'string' ? row.code : '';
  return (
    code === 'email_exists' ||
    code === 'user_already_exists' ||
    /already (been )?registered|already exists/i.test(message)
  );
}
