/** Android App Link and auth-callback parsing. Never log the values these return. */

export const APP_LINK_HOST = 'sitepack-preview.vercel.app';
export const APP_LINK_PACKAGE = 'uk.sitepack.app';

const AUTH_PARAM_KEYS = [
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'token_type',
  'expires_in',
  'expires_at',
] as const;

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  type: 'invite' | 'recovery';
};

export type StashedAuth =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'pkce'; code: string };

type ParsedLink = {
  pathname: string;
  search: string;
  hash: string;
};

let stagedJoin = '';
let stagedReset = '';
let pending: StashedAuth | null = null;
let pendingId: string | null = null;
let passwordSetup = false;
const handled = new Set<string>();

export function resetAppLinkCapture(): void {
  stagedJoin = '';
  stagedReset = '';
  pending = null;
  pendingId = null;
  passwordSetup = false;
  handled.clear();
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/** A leading `//` is still an in-app path. Collapse it to one slash before routing. */
function collapseLeadingSlashes(pathname: string): string {
  if (!pathname) return '/';
  return pathname.replace(/^\/{2,}/, '/');
}

export function parseAppLink(input: string): ParsedLink | null {
  if (!input) return { pathname: '/', search: '', hash: '' };
  if (input.startsWith('/')) {
    const hashAt = input.indexOf('#');
    const beforeHash = hashAt >= 0 ? input.slice(0, hashAt) : input;
    const queryAt = beforeHash.indexOf('?');
    return {
      pathname: collapseLeadingSlashes(queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash),
      search: queryAt >= 0 ? beforeHash.slice(queryAt) : '',
      hash: hashAt >= 0 ? input.slice(hashAt) : '',
    };
  }
  try {
    const url = new URL(input);
    let pathname = url.pathname || '/';
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.hostname) {
      const rest = url.pathname === '/' ? '' : url.pathname;
      pathname = `/${url.hostname}${rest}`;
    }
    return { pathname: collapseLeadingSlashes(pathname), search: url.search, hash: url.hash };
  } catch {
    return null;
  }
}

function singleSegment(pathname: string, root: 'join' | 'reset'): string | null {
  const match = new RegExp(`^/${root}/([^/?#]+)$`).exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Code segment of `/join/<code>`, or null. */
export function joinCodeFromPath(pathname: string): string | null {
  return singleSegment(pathname, 'join');
}

/** Code segment of `/reset/<code>`, or null. `/reset` alone has no code. */
export function resetCodeFromPath(pathname: string): string | null {
  return singleSegment(pathname, 'reset');
}

function tokensFromParams(params: URLSearchParams): AuthTokens | null {
  const type = params.get('type') ?? '';
  if (type !== 'invite' && type !== 'recovery') return null;
  const accessToken = params.get('access_token') ?? '';
  const refreshToken = params.get('refresh_token') ?? '';
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, type };
}

/** Invite or recovery session tokens from the URL hash. The query string is never a session. */
export function authTokensFromUrl(url: string | null): AuthTokens | null {
  if (!url) return null;
  const parsed = parseAppLink(url);
  if (!parsed?.hash) return null;
  return tokensFromParams(new URLSearchParams(parsed.hash.replace(/^#/, '')));
}

/**
 * Native session intake. Hash tokens only, and only on the verified App Link
 * host for `/set-password` or `/reset`. The `sitepack://` scheme is refused.
 */
function nativeSessionFromUrl(url: string): AuthTokens | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== APP_LINK_HOST) return null;
  const parsed = parseAppLink(url);
  if (!parsed || !isAuthCallbackPath(parsed.pathname)) return null;
  return authTokensFromUrl(url);
}

function isAuthCallbackPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return path === '/set-password' || path === '/reset';
}

/**
 * PKCE `code` on `/set-password` or `/reset`. A join code in the path is not this.
 * Hash session tokens win when both are present. Query tokens are ignored.
 */
export function pkceCodeFromUrl(url: string | null): string | null {
  if (!url || authTokensFromUrl(url)) return null;
  const parsed = parseAppLink(url);
  if (!parsed || !isAuthCallbackPath(parsed.pathname)) return null;
  const search = parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search;
  const code = new URLSearchParams(search).get('code') ?? '';
  return code ? code : null;
}

/** Path plus leftover query, with auth tokens and the hash removed. Keeps `/join/<code>`. */
export function browserPathWithoutAuth(input: string): string | null {
  const parsed = parseAppLink(input);
  if (!parsed) return null;
  const search = parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search;
  const params = new URLSearchParams(search);
  for (const key of AUTH_PARAM_KEYS) params.delete(key);
  if (pkceCodeFromUrl(input)) params.delete('code');
  const type = params.get('type');
  if (type === 'invite' || type === 'recovery') params.delete('type');
  const qs = params.toString();
  const path = parsed.pathname || '/';
  return `${path}${qs ? `?${qs}` : ''}`;
}

/** Route Expo Router should open. Codes and tokens are not left in the path. */
export function routerPathFromLink(input: string): string {
  const parsed = parseAppLink(input);
  if (!parsed) return '/';
  if (joinCodeFromPath(parsed.pathname)) return '/join';
  if (resetCodeFromPath(parsed.pathname)) return '/reset';
  return browserPathWithoutAuth(input) ?? '/';
}

export function stageJoinCode(code: string): void {
  stagedJoin = code;
}

export function peekStagedJoinCode(): string {
  return stagedJoin;
}

export function clearStagedJoinCode(): void {
  stagedJoin = '';
}

export function stageResetCode(code: string): void {
  stagedReset = code;
}

export function peekStagedResetCode(): string {
  return stagedReset;
}

export function clearStagedResetCode(): void {
  stagedReset = '';
}

export function passwordSetupExpected(): boolean {
  return passwordSetup;
}

export function consumePasswordSetup(): boolean {
  const value = passwordSetup;
  passwordSetup = false;
  return value;
}

/** Remember tokens or a PKCE code from a launch URL. A second call with the same URL is a no-op. */
export function stashAuthCallback(url: string | null, options?: { native?: boolean }): void {
  if (!url) return;
  const id = fingerprint(url);
  if (handled.has(id) || pendingId === id) return;
  const tokens = options?.native ? nativeSessionFromUrl(url) : authTokensFromUrl(url);
  if (tokens) {
    pendingId = id;
    passwordSetup = true;
    pending = { kind: 'session', accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    return;
  }
  const code = pkceCodeFromUrl(url);
  if (!code) return;
  pendingId = id;
  passwordSetup = true;
  pending = { kind: 'pkce', code };
}

export function peekAuthCallback(): StashedAuth | null {
  return pending;
}

export function takeAuthCallback(): StashedAuth | null {
  if (!pending || !pendingId) return null;
  handled.add(pendingId);
  const value = pending;
  pending = null;
  pendingId = null;
  return value;
}

/** Native entry. Stashes secrets, then returns the path the router may keep. */
export function captureIncomingLink(input: string): string {
  stashAuthCallback(input, { native: true });
  const parsed = parseAppLink(input);
  if (parsed) {
    const join = joinCodeFromPath(parsed.pathname);
    if (join) stageJoinCode(join);
    const reset = resetCodeFromPath(parsed.pathname);
    if (reset) stageResetCode(reset);
  }
  const next = routerPathFromLink(input);
  if (/access_token|refresh_token/.test(next)) return '/';
  return next || '/';
}
