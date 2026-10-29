import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  hmacSha256Hex,
  isJoinCodeShape,
  isUsernameShape,
  normalizeJoinCode,
  normalizeUsername,
  passwordHasLettersAndDigits,
  placeholderEmail,
  loadPublishableKey,
  loadSecretKey,
  platformClientIp,
} from './joinCodes.ts';

export { hmacSha256Hex, platformClientIp, placeholderEmail, passwordHasLettersAndDigits };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Referrer-Policy': 'no-referrer',
};

export function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'join_rejected' }, 405);
  return null;
}

/** JOIN_CODE_PEPPER is an edge function secret. SQL never sees it. */
export function pepperOrNull(): string | null {
  const pepper = Deno.env.get('JOIN_CODE_PEPPER') ?? '';
  if (!pepper) {
    console.error(JSON.stringify({ error: 'pepper_not_configured' }));
    return null;
  }
  return pepper;
}

export function clientIp(req: Request): string {
  return platformClientIp(req.headers, Deno.env.get('JOIN_IP_HEADER'));
}

export function userAgent(req: Request): string {
  return (req.headers.get('user-agent') ?? '').slice(0, 200);
}

/**
 * Auth and service calls. The key is SUPABASE_SECRET_KEYS['default'], an
 * sb_secret_ value. Sb-Forwarded-For carries the full client IP. Auth honours
 * that header only after IP Address Forwarding is turned on at ship.
 * A missing or invalid key refuses the request. There is no other key.
 */
export function serviceClient(ip: string): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const loaded = loadSecretKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
  if (!loaded.ok) {
    console.error(JSON.stringify({ error: 'secret_key_missing' }));
    return null;
  }
  return createClient(url, loaded.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'Sb-Forwarded-For': ip } },
  });
}

/**
 * Calls RPCs as the signed-in person. The key is SUPABASE_PUBLISHABLE_KEYS['default'].
 * A missing or invalid key refuses the request. There is no other key.
 */
export function userClient(req: Request): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const loaded = loadPublishableKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'));
  if (!loaded.ok) {
    console.error(JSON.stringify({ error: 'publishable_key_missing' }));
    return null;
  }
  const authorization = req.headers.get('Authorization') ?? '';
  return createClient(url, loaded.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
}

type ErrorLike = { message?: string; details?: string; hint?: string };

export function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const row = error as ErrorLike;
  return [row.message, row.details, row.hint].filter((part) => typeof part === 'string').join('\n');
}

const KNOWN = [
  'username_taken',
  'invalid_input',
  'weak_password',
  'not_authorized',
  'cap_out_of_range',
  'expiry_out_of_range',
  'label_too_long',
  'code_in_use',
  'rate_limited',
  'join_rejected',
  'reset_rejected',
  'sign_in_failed',
] as const;

export function knownCode(error: unknown, fallback: string): string {
  const text = errorText(error);
  return KNOWN.find((code) => text.includes(code)) ?? fallback;
}

export async function hashCode(raw: string, pepper: string): Promise<string | null> {
  const normalized = normalizeJoinCode(raw);
  if (!isJoinCodeShape(normalized)) return null;
  return hmacSha256Hex(normalized, pepper);
}

export function usernameOrNull(raw: string): string | null {
  const username = normalizeUsername(raw);
  if (!isUsernameShape(username)) return null;
  return username;
}

type AdminResult = {
  ok?: boolean;
  error?: string;
  site_id?: string;
  auth_user_id?: string;
  reset_id?: string;
  taken?: boolean;
  code?: string;
  id?: string;
};

export function readResult(data: unknown): AdminResult {
  if (!data || typeof data !== 'object') return {};
  return data as AdminResult;
}

/** Roughly the cost of a password check, so a username miss is not obviously faster. */
export async function padLoginMiss(password: string): Promise<void> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode('sitepack-login'),
        iterations: 120000,
        hash: 'SHA-256',
      },
      key,
      256
    );
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
