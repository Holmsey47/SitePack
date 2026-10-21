import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  hmacSha256Hex,
  isJoinCodeShape,
  isUsernameShape,
  normalizeJoinCode,
  normalizeUsername,
  passwordHasLettersAndDigits,
  placeholderEmail,
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

function secretKey(): string {
  return Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

/**
 * Auth and service calls. Sb-Forwarded-For is the full client IP so Auth can
 * rate-limit once IP Address Forwarding is on. The key must be an sb_secret_ key
 * for that header to be honored. This function does not change that setting.
 */
export function serviceClient(ip: string): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  return createClient(url, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'Sb-Forwarded-For': ip } },
  });
}

/** Calls RPCs as the signed-in person. verify_jwt on the function checks the bearer token. */
export function userClient(req: Request): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authorization = req.headers.get('Authorization') ?? '';
  return createClient(url, anon, {
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
