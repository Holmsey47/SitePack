import { clientIp, hashCode, json, knownCode, pepperOrNull, preflight, serviceClient } from '../_shared/joinHttp.ts';

/**
 * Logged-in preview and redeem. verify_jwt is true.
 * The user id comes from the verified JWT. The IP comes from the request
 * headers. Neither value is taken from the body. SQL is service_role only.
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

  let body: { code?: string; preview?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }

  const codeHash = await hashCode(body.code ?? '', pepper);
  if (!codeHash) return json({ error: 'invalid_input' }, 400);

  const ip = clientIp(req);
  const admin = serviceClient(ip);
  if (!admin) return json({ error: 'not_authorized' }, 500);

  const token = authorization.replace(/^bearer\s+/i, '').trim();
  const verified = await admin.auth.getUser(token);
  if (verified.error || !verified.data.user) {
    return json({ error: 'not_authorized' }, 401);
  }

  const args = {
    p_user_id: verified.data.user.id,
    p_code_hash: codeHash,
    p_client_ip: ip,
  };
  const called =
    body.preview === true ? await admin.rpc('preview_site_share', args) : await admin.rpc('redeem_site_share', args);
  if (called.error) {
    const codeName = knownCode(called.error, 'invalid_input');
    const status = codeName === 'not_authorized' ? 403 : 400;
    return json({ error: codeName }, status);
  }
  const row = called.data && typeof called.data === 'object' ? (called.data as { error?: unknown }) : {};
  if (typeof row.error === 'string') {
    const codeName = knownCode(row.error, 'invalid_input');
    const status = codeName === 'not_authorized' ? 403 : 400;
    return json({ error: codeName }, status);
  }
  return json(called.data ?? {});
});
