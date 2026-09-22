export function inviteFailureMessage(bodyError: string | null | undefined, fallback: string): string {
  const text = bodyError?.trim() || fallback;
  if (/already (been )?registered|already exists/i.test(text)) {
    return 'This person is already in the company and signs in with email and password.';
  }
  return text;
}
