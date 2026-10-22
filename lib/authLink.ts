/**
 * Web sign-in links (invite and recovery) arrive as an implicit-flow URL hash.
 * GoTrue's GET /verify redirect calls issueRefreshToken with method "otp" for
 * every email link — invite, recovery, and magiclink alike. The fragment's
 * type= string is not copied into the access token's amr claim.
 * PKCE stamps "invite" or "recovery" on the auth code, but that arrives as
 * ?code= and is left to supabase-js detectSessionInUrl. magiclink is not
 * stamped on the hash this app consumes, so a magiclink amr is refused.
 */

export const INVALID_AUTH_LINK = "This link has expired or isn't valid. Ask for a new one.";

/** A link older than this is refused, even if the JWT exp is still in the future. */
export const AUTH_LINK_MAX_AGE_SECONDS = 15 * 60;

/** Small allowance so a phone clock a little ahead of the server still works. */
const AUTH_LINK_CLOCK_SKEW_SECONDS = 60;

const TOKEN_PARAMS = ['access_token', 'refresh_token'] as const;

export type AuthLinkPurpose = 'invite' | 'recovery';

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  purpose: AuthLinkPurpose;
};

export type AccountIdentity = {
  id?: string | null;
  email?: string | null;
  username?: string | null;
};

export type ExistingSession =
  | { state: 'none' }
  | { state: 'unknown' }
  | { state: 'signed-in'; identity: AccountIdentity };

type ClaimCheck =
  | { ok: true; sub: string | null; email: string | null }
  | { ok: false };

export function authLinkPurpose(pathname: string): AuthLinkPurpose | null {
  const path = pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase() || '/';
  if (path === '/set-password') return 'invite';
  if (path === '/reset') return 'recovery';
  if (path.startsWith('/reset/')) {
    const code = path.slice('/reset/'.length);
    if (code && !code.includes('/')) return 'recovery';
  }
  return null;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(value, 'https://sitepack.local');
    } catch {
      return null;
    }
  }
}

/** Hash only. Query tokens are ignored, including when a hash is also present. */
export function sessionTokensFromUrl(url: string | null): SessionTokens | null {
  if (!url) return null;
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const purpose = authLinkPurpose(parsed.pathname);
  if (!purpose) return null;
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token') ?? '';
  const refreshToken = hash.get('refresh_token') ?? '';
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, purpose };
}

export function planBrowserUrl(href: string): { nextHref: string; stripped: boolean; sessionUrl: string | null } {
  const parsed = parseUrl(href);
  if (!parsed) return { nextHref: href, stripped: false, sessionUrl: null };
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const hashHas = TOKEN_PARAMS.some((key) => (hash.get(key) ?? '') !== '');
  const queryHas = TOKEN_PARAMS.some((key) => parsed.searchParams.has(key));
  if (!hashHas && !queryHas) return { nextHref: href, stripped: false, sessionUrl: null };
  const original = parsed.href;
  if (hashHas) parsed.hash = '';
  for (const key of TOKEN_PARAMS) parsed.searchParams.delete(key);
  const nextHref = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const sessionUrl = hashHas && authLinkPurpose(parsed.pathname) ? original : null;
  return { nextHref, stripped: true, sessionUrl };
}

let heldWebAuthUrl: string | null | undefined;
let scrubberInstalled = false;

function rememberSessionUrl(sessionUrl: string | null) {
  if (heldWebAuthUrl === undefined) heldWebAuthUrl = sessionUrl;
}

/** Drop access and refresh tokens from any history write, and from the current URL. */
export function installAuthUrlScrubber(): void {
  if (typeof window === 'undefined' || scrubberInstalled) return;
  scrubberInstalled = true;
  const originalReplace = window.history.replaceState.bind(window.history);
  const originalPush = window.history.pushState.bind(window.history);
  const clean = (url: string | URL | null | undefined) => {
    if (url == null) return url;
    try {
      const href = new URL(typeof url === 'string' ? url : url.toString(), window.location.origin).href;
      const plan = planBrowserUrl(href);
      if (!plan.stripped) return url;
      rememberSessionUrl(plan.sessionUrl);
      return plan.nextHref;
    } catch {
      return url;
    }
  };
  window.history.replaceState = (state, unused, url) => {
    originalReplace(state, unused, clean(url));
  };
  window.history.pushState = (state, unused, url) => {
    originalPush(state, unused, clean(url));
  };
  window.addEventListener('hashchange', () => {
    ensureWebAuthUrlStripped();
  });
}

/** Synchronous. Safe to call more than once. Keeps the first allow-listed link in memory. */
export function ensureWebAuthUrlStripped(): void {
  if (typeof window === 'undefined') return;
  installAuthUrlScrubber();
  try {
    const plan = planBrowserUrl(window.location.href);
    rememberSessionUrl(plan.sessionUrl);
    if (plan.stripped) {
      window.history.replaceState(window.history.state, '', plan.nextHref);
    }
  } catch {
    rememberSessionUrl(null);
  }
}

/** Read the in-memory link once, then drop it. Never written to storage. */
export function takeWebAuthUrl(): string | null {
  ensureWebAuthUrlStripped();
  const url = heldWebAuthUrl ?? null;
  heldWebAuthUrl = null;
  return url;
}

function decodeBase64Url(segment: string): string | null {
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (padded.length % 4)) % 4;
    const binary = globalThis.atob(padded + '='.repeat(padLength));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function amrMethods(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const methods: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry) methods.push(entry);
    else if (entry && typeof entry === 'object' && 'method' in entry) {
      const method = (entry as { method?: unknown }).method;
      if (typeof method === 'string' && method) methods.push(method);
    }
  }
  return methods;
}

const ALLOWED_AMR: Record<AuthLinkPurpose, ReadonlySet<string>> = {
  invite: new Set(['invite', 'otp']),
  recovery: new Set(['recovery', 'otp']),
};

export function assessAuthLinkClaims(accessToken: string, purpose: AuthLinkPurpose, nowSeconds: number): ClaimCheck {
  const parts = accessToken.split('.');
  if (parts.length < 2) return { ok: false };
  const decoded = decodeBase64Url(parts[1] ?? '');
  if (!decoded) return { ok: false };
  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return { ok: false };
  }
  if (!payload || typeof payload !== 'object') return { ok: false };
  const claims = payload as { sub?: unknown; email?: unknown; amr?: unknown; iat?: unknown };
  const iat = claims.iat;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return { ok: false };
  const age = nowSeconds - iat;
  if (age > AUTH_LINK_MAX_AGE_SECONDS || age < -AUTH_LINK_CLOCK_SKEW_SECONDS) return { ok: false };
  const methods = amrMethods(claims.amr);
  if (!methods.some((method) => ALLOWED_AMR[purpose].has(method))) return { ok: false };
  const sub = typeof claims.sub === 'string' && claims.sub ? claims.sub : null;
  const email = typeof claims.email === 'string' && claims.email.trim() ? claims.email.trim() : null;
  return { ok: true, sub, email };
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function sameAccount(current: AccountIdentity, target: AccountIdentity): boolean {
  const currentId = norm(current.id);
  const targetId = norm(target.id);
  if (currentId && targetId) return currentId === targetId;
  const currentEmail = norm(current.email);
  const targetEmail = norm(target.email);
  if (currentEmail && targetEmail) return currentEmail === targetEmail;
  return false;
}

export function accountLabel(identity: AccountIdentity): string {
  const email = identity.email?.trim();
  if (email) return email;
  const username = identity.username?.trim();
  if (username) return username;
  return 'your account';
}

export function confirmSessionMessage(current: AccountIdentity, targetEmail: string | null): string {
  const target = targetEmail?.trim() || 'another account';
  return `You're signed in as ${accountLabel(current)}. This link is for ${target}. Sign out and continue?`;
}

export function accountIdentityFromUser(user: {
  id?: string | null;
  email?: string | null;
  user_metadata?: { username?: unknown; user_name?: unknown } | null;
} | null | undefined): AccountIdentity | null {
  if (!user) return null;
  const username =
    typeof user.user_metadata?.username === 'string'
      ? user.user_metadata.username
      : typeof user.user_metadata?.user_name === 'string'
        ? user.user_metadata.user_name
        : null;
  if (!user.id && !user.email && !username) return null;
  return { id: user.id ?? null, email: user.email ?? null, username };
}

export type SettleAuthLinkDeps = {
  url: string | null;
  now: number;
  getExisting: () => Promise<ExistingSession>;
  verifyToken: (accessToken: string) => Promise<AccountIdentity | null>;
  setSession: (tokens: { accessToken: string; refreshToken: string }) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
};

export type AuthLinkOutcome =
  | { status: 'none' }
  | { status: 'declined' }
  | { status: 'applied'; purpose: AuthLinkPurpose }
  | { status: 'rejected'; message: string; signedOut: boolean };

async function signOutQuietly(signOut: () => Promise<void>) {
  try {
    await signOut();
  } catch {
    // The link is already discarded. A failed sign-out still must not keep it.
  }
}

/**
 * Decide and apply a hash sign-in link.
 * setSession is not called unless the path, claims, and any existing session allow it.
 */
export async function settleAuthLink(deps: SettleAuthLinkDeps): Promise<AuthLinkOutcome> {
  const parsed = sessionTokensFromUrl(deps.url);
  if (!parsed) return { status: 'none' };
  const claims = assessAuthLinkClaims(parsed.accessToken, parsed.purpose, deps.now);
  if (!claims.ok) return { status: 'rejected', message: INVALID_AUTH_LINK, signedOut: false };

  const existing = await deps.getExisting();
  if (existing.state !== 'none') {
    const verified = await deps.verifyToken(parsed.accessToken);
    const same = existing.state === 'signed-in' && verified !== null && sameAccount(existing.identity, verified);
    if (!same) {
      const current = existing.state === 'signed-in' ? existing.identity : {};
      const targetEmail = verified?.email ?? claims.email;
      const accepted = await deps.confirm(confirmSessionMessage(current, targetEmail));
      if (!accepted) return { status: 'declined' };
      await signOutQuietly(deps.signOut);
    }
  }

  const { error } = await deps.setSession({
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
  });
  if (error) {
    await signOutQuietly(deps.signOut);
    return { status: 'rejected', message: INVALID_AUTH_LINK, signedOut: true };
  }
  const after = assessAuthLinkClaims(parsed.accessToken, parsed.purpose, deps.now);
  if (!after.ok) {
    await signOutQuietly(deps.signOut);
    return { status: 'rejected', message: INVALID_AUTH_LINK, signedOut: true };
  }
  return { status: 'applied', purpose: parsed.purpose };
}

// Drop hash tokens before supabase-js is created. Importing this module is enough.
installAuthUrlScrubber();
ensureWebAuthUrlStripped();
