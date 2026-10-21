/** Join-code alphabet: 31 characters, no 0, O, 1, I, or L. */
export const JOIN_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const JOIN_CODE_LENGTH = 8;
export const JOIN_DEFAULT_MAX_USES = 10;
export const JOIN_HARD_MAX_USES = 25;
export const JOIN_DEFAULT_HOURS = 24;
export const JOIN_MAX_HOURS = 24 * 7;
export const JOIN_IP_FAILURE_LIMIT = 10;
export const JOIN_IP_WINDOW_MINUTES = 15;
export const JOIN_GLOBAL_FAILURE_LIMIT = 100;
export const JOIN_GLOBAL_WINDOW_MINUTES = 10;
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

/** Display form XXXX-XXXX. Hashing uses the normalised code, not this. */
/** Where to leave the address bar after reading a code from the path. */
export function publicCodePath(pathname: string): '/join' | '/reset' | null {
  if (pathname.startsWith('/join/')) return '/join';
  if (pathname.startsWith('/reset/')) return '/reset';
  return null;
}

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
  return `Join ${input.company} on SitePack for ${input.site}: ${link}  Code: ${formatJoinCode(compact)}`;
}

export function resetShareText(name: string, code: string): string {
  return `SitePack password reset for ${name}: ${formatJoinCode(code)}. It lasts 30 minutes and works once.`;
}

type HeaderSource = { get(name: string): string | null };

/**
 * Platform client IP. The rightmost X-Forwarded-For hop is the one a trusted
 * proxy appended. The leftmost value is client-supplied and is ignored.
 */
export function platformClientIp(headers: HeaderSource): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const rightmost = parts[parts.length - 1];
    if (rightmost) return rightmost.slice(0, 64);
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 64);
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf.slice(0, 64);
  return 'unknown';
}

export function joinFailureMessage(code: string): string {
  if (code === 'username_taken') return 'That username is taken. Try another.';
  if (code === 'weak_password' || code === 'invalid_input') {
    return 'Use at least 8 characters, with letters and digits. Name and username are required.';
  }
  if (code === 'cap_out_of_range') return 'Max uses must be between 1 and 25.';
  if (code === 'expiry_out_of_range') return 'A code can last up to 7 days.';
  if (code === 'label_too_long') return 'Label must be 40 characters or fewer.';
  if (code === 'pepper_not_configured') return 'Join codes are not set up yet.';
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

/** HMAC-SHA256 hex. Pepper stays in the edge secret or the database setting. */
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
