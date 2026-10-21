import { INVITE_REDIRECT_NOT_CONFIGURED } from '@/supabase/functions/_shared/inviteRedirect';

export function inviteFailureMessage(bodyError: string | null | undefined, fallback: string): string {
  const text = bodyError?.trim() || fallback;
  if (text.includes(INVITE_REDIRECT_NOT_CONFIGURED)) {
    return 'The invite link is not set up, so the email was not sent.';
  }
  if (/already (been )?registered|already exists/i.test(text)) {
    return 'This person is already in the company and signs in with email and password.';
  }
  return text;
}
