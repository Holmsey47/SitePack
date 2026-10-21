export const INVITE_REDIRECT_NOT_CONFIGURED = 'invite_redirect_not_configured';

export type InviteRedirect =
  | { ok: true; redirectTo: string }
  | { ok: false; error: typeof INVITE_REDIRECT_NOT_CONFIGURED };

const LOCAL_HTTP_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * Invite mail must not invent a localhost link.
 * https is allowed. http is allowed only for loopback dev hosts.
 */
export function resolveInviteRedirect(raw: string | null | undefined): InviteRedirect {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return { ok: false, error: INVITE_REDIRECT_NOT_CONFIGURED };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: INVITE_REDIRECT_NOT_CONFIGURED };
  }

  const localHttp = url.protocol === 'http:' && LOCAL_HTTP_HOSTS.has(url.hostname);
  if (url.protocol === 'https:' || localHttp) {
    return { ok: true, redirectTo: value };
  }

  return { ok: false, error: INVITE_REDIRECT_NOT_CONFIGURED };
}
