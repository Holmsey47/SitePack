import { authTokensFromUrl } from './appLinks.ts';

export type InviteGrant = {
  accessToken: string;
  refreshToken: string;
};

/** Invite emails land with the new person's session in the URL hash.
 * Password login uses PKCE, which ignores that hash and keeps whoever is already signed in.
 * A bare `?code=` is not this grant.
 */
export function inviteGrantFromUrl(url: string | null): InviteGrant | null {
  const tokens = authTokensFromUrl(url);
  if (!tokens) return null;
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

/** The invite email is one-time. A second click does not issue another session. */
export function spentInviteGuidance(url: string | null): string {
  if (inviteGrantFromUrl(url)) {
    return 'Reload this page, then set the password. Do not open the email again.';
  }
  return 'Stop. The email cannot be opened again.';
}
