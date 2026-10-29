import { accessTokenFromAuthorization, generateJoinCode } from '../_shared/joinCodes.ts';
import { hashCode, json, knownCode, pepperOrNull, preflight, readResult, userClient } from '../_shared/joinHttp.ts';

/**
 * Logged-in code issue. verify_jwt stays true: the caller sends a user access token.
 * The handler rejects a bearer that is not that token. The publishable key is not a JWT.
 * Generates the code, HMACs it with JOIN_CODE_PEPPER, and stores only the hash.
 * Role and site checks stay in SQL under the caller's identity.
 */
Deno.serve(async (req) => {
  const early = preflight(req);
  if (early && req.method === 'OPTIONS') return early;
  if (req.method !== 'POST') return json({ error: 'not_authorized' }, 405);

  const pepper = pepperOrNull();
  if (!pepper) return json({ error: 'join_rejected' }, 500);

  if (!accessTokenFromAuthorization(req.headers.get('Authorization'))) {
    return json({ error: 'not_authorized' }, 401);
  }

  let body: { site_id?: string; label?: string | null; max_uses?: number; hours?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }

  const user = userClient(req);
  if (!user) return json({ error: 'join_rejected' }, 500);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateJoinCode();
    const codeHash = await hashCode(code, pepper);
    const created = await user.rpc('create_join_code', {
      p_site_id: body.site_id,
      p_label: body.label ?? null,
      p_max_uses: body.max_uses ?? 10,
      p_hours: body.hours ?? 24,
      p_code_hash: codeHash,
    });
    if (created.error) {
      const codeName = knownCode(created.error, 'join_rejected');
      if (codeName === 'code_in_use') continue;
      const status = codeName === 'not_authorized' ? 403 : 400;
      return json({ error: codeName }, status);
    }
    const row = readResult(created.data);
    return json({
      ...row,
      code: `${code.slice(0, 4)}-${code.slice(4)}`,
    });
  }

  return json({ error: 'join_rejected' }, 400);
});
