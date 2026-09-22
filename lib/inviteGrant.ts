export type InviteGrant = {
  accessToken: string;
  refreshToken: string;
};

/** Invite emails land with the new person's session in the URL hash.
 * Password login uses PKCE, which ignores that hash and keeps whoever is already signed in.
 */
export function inviteGrantFromUrl(url: string | null): InviteGrant | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const type = hash.get('type') ?? '';
  if (type !== 'invite' && type !== 'recovery') return null;
  const accessToken = hash.get('access_token') ?? '';
  const refreshToken = hash.get('refresh_token') ?? '';
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

/** The invite email is one-time. A second click does not issue another session. */
export function spentInviteGuidance(url: string | null): string {
  if (inviteGrantFromUrl(url)) {
    return 'Reload this page, then set the password. Do not open the email again.';
  }
  return 'Stop. The email cannot be opened again.';
}
