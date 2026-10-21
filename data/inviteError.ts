import { INVITE_REDIRECT_NOT_CONFIGURED } from '@/supabase/functions/_shared/inviteRedirect';

const INVITE_FAILED = 'The invite did not send. Try again.';

const MESSAGES: Record<string, string> = {
  not_authorized: 'You can’t do that.',
  invalid_input: 'Check the email and name, then try again.',
  person_not_found: 'That person is not in the company.',
  already_member: 'This person is already in the company and signs in with email and password.',
  invite_failed: INVITE_FAILED,
  invite_redirect_not_configured: 'The invite link is not set up, so the email was not sent.',
  email_required: 'Enter an email to attach the login.',
  email_in_use: 'That email is already used in this company.',
  already_has_login: 'This person already has a login.',
  email_and_name_required: 'Enter an email and a name.',
  invalid_role: 'Pick a role.',
  site_not_found: 'That site is not in the company.',
};

const PLAIN = new Set(Object.values(MESSAGES));

/**
 * Plain words for an invite code. A raw Supabase or GoTrue message is not shown.
 * A sentence this function already produced is left as it is.
 */
export function inviteFailureMessage(bodyError: string | null | undefined, fallback?: string): string {
  const text = bodyError?.trim() || '';
  if (text && MESSAGES[text]) return MESSAGES[text];
  if (text && PLAIN.has(text)) return text;
  if (/already (been )?registered|already exists/i.test(text)) return MESSAGES.already_member;
  if (text.includes(INVITE_REDIRECT_NOT_CONFIGURED)) return MESSAGES.invite_redirect_not_configured;
  const safeFallback = fallback?.trim() || '';
  if (safeFallback && (MESSAGES[safeFallback] || PLAIN.has(safeFallback))) {
    return MESSAGES[safeFallback] ?? safeFallback;
  }
  return INVITE_FAILED;
}
