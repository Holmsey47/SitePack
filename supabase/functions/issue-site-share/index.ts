import { generateJoinCode } from '../_shared/joinCodes.ts';
import { hashCode, json, knownCode, pepperOrNull, preflight, userClient } from '../_shared/joinHttp.ts';

/**
 * Owner share invite. verify_jwt is true.
 * The code is generated here, HMAC'd with JOIN_CODE_PEPPER, and only the hash is stored.
 * Who may share, and which sections, stay in SQL under the caller's identity.
 */
Deno.serve(async (req) => {
  const early = preflight(req);
  if (early && req.method === 'OPTIONS') return early;
  if (req.method !== 'POST') return json({ error: 'not_authorized' }, 405);

  const pepper = pepperOrNull();
  if (!pepper) return json({ error: 'join_rejected' }, 500);

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'not_authorized' }, 401);
  }

  let body: {
    site_id?: string;
    guest_company_name?: string;
    drawings?: boolean;
    variations?: boolean;
    snags?: boolean;
    sign_in?: boolean;
    inductions?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }

  const user = userClient(req);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateJoinCode();
    const codeHash = await hashCode(code, pepper);
    const created = await user.rpc('create_site_share_invite', {
      p_site_id: body.site_id,
      p_guest_company_name: body.guest_company_name ?? '',
      p_drawings: body.drawings === true,
      p_variations: body.variations === true,
      p_snags: body.snags === true,
      p_sign_in: body.sign_in === true,
      p_inductions: body.inductions === true,
      p_code_hash: codeHash,
    });
    if (created.error) {
      const codeName = knownCode(created.error, 'not_authorized');
      if (codeName === 'code_in_use') continue;
      const status = codeName === 'not_authorized' ? 403 : 400;
      return json({ error: codeName }, status);
    }
    const row = created.data && typeof created.data === 'object' ? (created.data as Record<string, unknown>) : {};
    return json({
      ...row,
      code: `${code.slice(0, 4)}-${code.slice(4)}`,
    });
  }

  return json({ error: 'code_in_use' }, 400);
});
