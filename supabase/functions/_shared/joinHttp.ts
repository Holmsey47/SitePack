import {
  hmacSha256Hex,
  isJoinCodeShape,
  isUsernameShape,
  normalizeJoinCode,
  normalizeUsername,
  passwordHasLettersAndDigits,
  placeholderEmail,
  platformClientIp,
} from '../../../data/joinCodes.ts';

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

/**
 * JOIN_CODE_PEPPER is an edge function secret. Do not commit a value.
 * It must match the database setting app.join_code_pepper, which
 * create_join_code and reset_password_code use to hash. Set both at deploy.
 * Never put the pepper in the repo, the client, or a migration.
 */
export function pepperOrNull(): string | null {
  const pepper = Deno.env.get('JOIN_CODE_PEPPER') ?? '';
  if (!pepper) {
    console.error(JSON.stringify({ error: 'pepper_not_configured' }));
    return null;
  }
  return pepper;
}

export function clientIp(req: Request): string {
  return platformClientIp(req.headers);
}

export function userAgent(req: Request): string {
  return (req.headers.get('user-agent') ?? '').slice(0, 200);
}

type ErrorLike = { message?: string; details?: string; hint?: string };

export function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const row = error as ErrorLike;
  return [row.message, row.details, row.hint].filter((part) => typeof part === 'string').join('\n');
}

export function joinClientCode(error: unknown): string {
  const text = errorText(error);
  if (text.includes('username_taken')) return 'username_taken';
  if (text.includes('invalid_input')) return 'invalid_input';
  if (/password/i.test(text)) return 'weak_password';
  return 'join_rejected';
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

type AdminResult = { ok?: boolean; error?: string; site_id?: string; auth_user_id?: string; reset_id?: string };

export function readResult(data: unknown): AdminResult {
  if (!data || typeof data !== 'object') return {};
  return data as AdminResult;
}
