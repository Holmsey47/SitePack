import { clientIp, json, knownCode, preflight, serviceClient, userClient } from '../_shared/joinHttp.ts';

/**
 * Signed read for one current drawing on a shared site. verify_jwt is true.
 * SQL checks the share, the current revision, and the path. This function
 * only asks storage for a short URL after that check. It does not grant storage.
 */
Deno.serve(async (req) => {
  const early = preflight(req);
  if (early && req.method === 'OPTIONS') return early;
  if (req.method !== 'POST') return json({ error: 'not_authorized' }, 405);

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'not_authorized' }, 401);
  }

  let body: { drawing_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }

  const user = userClient(req);
  const checked = await user.rpc('shared_drawing_url', { p_drawing_id: body.drawing_id });
  if (checked.error) {
    const codeName = knownCode(checked.error, 'not_shared');
    const status = codeName === 'not_authorized' ? 403 : 400;
    return json({ error: codeName }, status);
  }

  const row = checked.data && typeof checked.data === 'object' ? (checked.data as { path?: unknown }) : {};
  const path = typeof row.path === 'string' ? row.path : '';
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\')) {
    return json({ error: 'invalid_path' }, 400);
  }

  const admin = serviceClient(clientIp(req));
  if (!admin) return json({ error: 'not_shared' }, 500);

  const signed = await admin.storage.from('drawings').createSignedUrl(path, 300);
  if (signed.error || !signed.data?.signedUrl) {
    console.error(JSON.stringify({ error: 'sign_failed' }));
    return json({ error: 'not_shared' }, 400);
  }
  return json({ url: signed.data.signedUrl, expires_in: 300 });
});
