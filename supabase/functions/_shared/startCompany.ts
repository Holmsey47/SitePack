import { resolveInviteRedirect } from './inviteRedirect.ts';

export {
  CHECK_YOUR_EMAIL,
  START_EMAIL_LIMIT,
  START_IP_LIMIT,
  inviteIsExistingAccount,
  parseStartCompany,
  startCompanyResult,
  startFailureMessage,
} from '../../../data/startCompany.ts';

export const DEFAULT_START_REDIRECT = 'https://sitepack-preview.vercel.app/set-password';

/**
 * Unset uses the preview set-password URL.
 * A set value uses the same https-or-loopback check as invite mail.
 */
export function startRedirect(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_START_REDIRECT;
  const decision = resolveInviteRedirect(raw);
  return decision.ok ? decision.redirectTo : null;
}
