/** Join-code alphabet: 31 characters, no 0, O, 1, I, or L. */
export const JOIN_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const JOIN_CODE_LENGTH = 8;
export const JOIN_DEFAULT_MAX_USES = 10;
export const JOIN_HARD_MAX_USES = 25;
export const JOIN_DEFAULT_HOURS = 24;
export const JOIN_MAX_HOURS = 24 * 7;
/** Hard cap on join and reset failures from one known IP. Unknown is not capped. */
export const JOIN_IP_FAILURE_LIMIT = 40;
export const JOIN_IP_WINDOW_MINUTES = 15;
/** Alert plus a short delay. A full global counter never rejects a request. */
export const JOIN_GLOBAL_FAILURE_LIMIT = 100;
export const JOIN_GLOBAL_WINDOW_MINUTES = 10;
/** Primary login limit: one username, not the whole crew. */
export const JOIN_USERNAME_FAILURE_LIMIT = 10;
/** Hard reset limit for one person. Guessed code hashes are not a key. */
export const JOIN_RESET_FAILURE_LIMIT = 10;
export const RESET_CODE_MINUTES = 30;
export const JOIN_WEB_ORIGIN = 'https://sitepack-preview.vercel.app';
export const PLACEHOLDER_EMAIL_DOMAIN = 'users.sitepack.invalid';

export const JOIN_REJECTED = 'join_rejected';
export const RESET_REJECTED = 'reset_rejected';
export const SIGN_IN_FAILED = 'sign_in_failed';

const CODE_SHAPE = new RegExp(`^[${JOIN_ALPHABET}]{${JOIN_CODE_LENGTH}}$`);

/** Upper-case, then strip spaces and dashes. The value that is hashed. */
export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isJoinCodeShape(input: string): boolean {
  return CODE_SHAPE.test(normalizeJoinCode(input));
}

/** Where to leave the address bar after reading a code from the path. */
export function publicCodePath(pathname: string): '/join' | '/reset' | null {
  if (pathname.startsWith('/join/')) return '/join';
  if (pathname.startsWith('/reset/')) return '/reset';
  return null;
}

/** Display form XXXX-XXXX. Hashing uses the normalised code, not this. */
export function formatJoinCode(input: string): string {
  const code = normalizeJoinCode(input);
  if (code.length !== JOIN_CODE_LENGTH) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function isUsernameShape(input: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,23}$/.test(normalizeUsername(input));
}

/** At least 8 characters, with a letter and a digit. */
export function passwordHasLettersAndDigits(password: string): boolean {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export function joinShareText(input: {
  company: string;
  site: string;
  code: string;
  origin?: string;
}): string {
  const compact = normalizeJoinCode(input.code);
  const origin = (input.origin ?? JOIN_WEB_ORIGIN).replace(/\/$/, '');
  const link = `${origin}/join/${compact}`;
  return `Join ${input.company} on SitePack for ${input.site}: ${link} Code: ${formatJoinCode(compact)}`;
}

export function resetShareText(name: string, code: string, origin?: string): string {
  const compact = normalizeJoinCode(code);
  const originClean = (origin ?? JOIN_WEB_ORIGIN).replace(/\/$/, '');
  const link = `${originClean}/reset/${compact}`;
  return `SitePack password reset for ${name}: ${link} Code: ${formatJoinCode(compact)}. It lasts 30 minutes and works once.`;
}

/** Snap a stored window back to the 24h / 3 day / 7 day choice. */
export function expiryChoiceHours(createdAt: string, expiresAt: string): number {
  const hours = Math.round((new Date(expiresAt).getTime() - new Date(createdAt).getTime()) / 3600000);
  if (!Number.isFinite(hours) || hours < 48) return 24;
  if (hours < 120) return 72;
  return JOIN_MAX_HOURS;
}

/**
 * Eight characters from JOIN_ALPHABET. Rejection sampling: a byte below 248,
 * then modulo 31, so each character is equally likely.
 */
export function generateJoinCode(): string {
  let out = '';
  const bytes = new Uint8Array(1);
  while (out.length < JOIN_CODE_LENGTH) {
    crypto.getRandomValues(bytes);
    if (bytes[0] < 248) out += JOIN_ALPHABET[bytes[0] % JOIN_ALPHABET.length];
  }
  return out;
}

type HeaderSource = { get(name: string): string | null };

function configuredIpHeader(explicit?: string | null): string {
  if (explicit != null && explicit.trim() !== '') return explicit.trim();
  const deno = (globalThis as { Deno?: { env?: { get?: (name: string) => string | undefined } } }).Deno;
  const fromDeno = deno?.env?.get?.('JOIN_IP_HEADER');
  if (fromDeno && fromDeno.trim()) return fromDeno.trim();
  if (typeof process !== 'undefined' && process.env?.JOIN_IP_HEADER) return process.env.JOIN_IP_HEADER;
  return 'cf-connecting-ip';
}

function forwardedParts(headers: HeaderSource): string[] {
  const forwarded = headers.get('x-forwarded-for');
  if (!forwarded) return [];
  return forwarded
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 1 is the rightmost hop. Never the leftmost client-supplied value. */
export function xffFromRight(headers: HeaderSource, fromRight: number): string | null {
  if (!Number.isInteger(fromRight) || fromRight < 1) return null;
  const parts = forwardedParts(headers);
  const index = parts.length - fromRight;
  if (index < 0) return null;
  const value = parts[index];
  if (!value) return null;
  return value.slice(0, 64);
}

/**
 * Client IP for rate-limit subjects and Auth forwarding.
 * JOIN_IP_HEADER defaults to cf-connecting-ip. The other accepted value is
 * x-forwarded-for:from-right:N (1 = the rightmost hop). A missing or
 * unparsable header is "unknown". The leftmost X-Forwarded-For value is never used.
 */
export function platformClientIp(headers: HeaderSource, mode?: string | null): string {
  const setting = configuredIpHeader(mode).toLowerCase();
  const fromRight = /^x-forwarded-for:from-right:(\d+)$/.exec(setting);
  if (fromRight) {
    return xffFromRight(headers, Number(fromRight[1])) ?? 'unknown';
  }
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf.slice(0, 64);
  return xffFromRight(headers, 1) ?? 'unknown';
}

function ipv4Subject(value: string): string | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
  }
  return parts.join('.');
}

function namedKey(
  raw: string | null | undefined,
  prefix: 'sb_secret_' | 'sb_publishable_'
): string | null {
  if (!raw || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = (parsed as Record<string, unknown>).default;
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
  return value;
}

/**
 * The sb_secret_ key Supabase injects as SUPABASE_SECRET_KEYS JSON.
 * There is no fallback. A missing or invalid value fails closed.
 */
export function loadSecretKey(
  raw: string | null | undefined
): { ok: true; key: string } | { ok: false; error: 'secret_key_missing' } {
  const key = namedKey(raw, 'sb_secret_');
  if (!key) return { ok: false, error: 'secret_key_missing' };
  return { ok: true, key };
}

/**
 * The sb_publishable_ key Supabase injects as SUPABASE_PUBLISHABLE_KEYS JSON.
 * There is no fallback. A missing or invalid value fails closed.
 */
export function loadPublishableKey(
  raw: string | null | undefined
): { ok: true; key: string } | { ok: false; error: 'publishable_key_missing' } {
  const key = namedKey(raw, 'sb_publishable_');
  if (!key) return { ok: false, error: 'publishable_key_missing' };
  return { ok: true, key };
}

function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  if (!parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part) && part.length > 0)) return null;
  try {
    const body = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A signed-in person's access token. Publishable and secret keys are not JWTs. */
export function isAuthenticatedUserJwt(token: string | null | undefined): boolean {
  if (typeof token !== 'string' || token.startsWith('sb_')) return false;
  return jwtPayload(token)?.role === 'authenticated';
}

/** The bearer token when it is a user access token. Anything else, including an API key, is refused. */
export function accessTokenFromAuthorization(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match || !isAuthenticatedUserJwt(match[1])) return null;
  return match[1];
}

/**
 * Rate-limit subject. IPv4 stays as written. IPv4-mapped IPv6 (::ffff:a.b.c.d)
 * becomes that IPv4. Other IPv6 collapses to the /64. Anything else is "unknown".
 */
export function ipRateSubject(ip: string | null | undefined): string {
  const raw = (ip ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]?.split('/')[0] ?? '';
  if (!raw || raw === 'unknown') return 'unknown';
  const mapped = raw.match(/^(?:::|(?:[0-9a-f]{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return ipv4Subject(mapped[1]) ?? 'unknown';
  if (!raw.includes(':')) return ipv4Subject(raw) ?? 'unknown';
  if ((raw.match(/::/g) ?? []).length > 1) return 'unknown';
  let groups: string[];
  if (raw.includes('::')) {
    const [head, tail] = raw.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return 'unknown';
    groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  } else {
    groups = raw.split(':');
  }
  if (groups.length !== 8) return 'unknown';
  const prefix = groups.slice(0, 4).map((group) => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return '';
    return group.padStart(4, '0');
  });
  if (prefix.some((group) => group === '')) return 'unknown';
  return prefix.join(':');
}

export function joinFailureMessage(code: string): string {
  if (code === 'username_taken') return 'That username is taken. Try another.';
  if (code === 'weak_password' || code === 'invalid_input') {
    return 'Use at least 8 characters, with letters and digits. Name and username are required.';
  }
  if (code === 'cap_out_of_range') return 'Max uses must be between 1 and 25.';
  if (code === 'expiry_out_of_range') return 'A code can last up to 7 days.';
  if (code === 'label_too_long') return 'Label must be 40 characters or fewer.';
  if (code === 'rate_limited') return 'Too many tries. Wait a few minutes.';
  return 'That code didn’t work. Check it and try again.';
}

export function signInFailureMessage(): string {
  return 'Couldn’t sign in. Check username and password and try again.';
}

export function resetFailureMessage(code: string): string {
  if (code === 'weak_password') return 'Use at least 8 characters, with letters and digits.';
  if (code === 'not_authorized') return 'You can’t reset that login.';
  if (code === 'rate_limited') return 'Too many tries. Wait a few minutes.';
  return 'That reset code didn’t work. Ask for a new one.';
}

/** HMAC-SHA256 hex. The pepper is the edge secret JOIN_CODE_PEPPER and never reaches SQL. */
export async function hmacSha256Hex(value: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function placeholderEmail(userId: string): string {
  return `${userId}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}
