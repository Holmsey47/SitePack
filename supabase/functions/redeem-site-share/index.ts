import { clientIp, hashCode, json, knownCode, pepperOrNull, preflight, userClient } from '../_shared/joinHttp.ts';

/**
 * Logged-in redeem. verify_jwt is true.
 * The person is already a member of their own firm. SQL checks that firm name
 * against the invite. This function only hashes the code.
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

  const user = userClient(req);
  if (body.preview === true) {
    const previewed = await user.rpc('preview_site_share', {
      p_code_hash: codeHash,
      p_client_ip: clientIp(req),
    });
    if (previewed.error) {
      const codeName = knownCode(previewed.error, 'invalid_input');
      const status = codeName === 'not_authorized' ? 403 : 400;
      return json({ error: codeName }, status);
    }
    const previewRow = previewed.data && typeof previewed.data === 'object' ? (previewed.data as { error?: unknown }) : {};
    if (typeof previewRow.error === 'string') {
      const codeName = knownCode(previewRow.error, 'invalid_input');
      const status = codeName === 'not_authorized' ? 403 : 400;
      return json({ error: codeName }, status);
    }
    return json(previewed.data ?? {});
  }

  const redeemed = await user.rpc('redeem_site_share', {
    p_code_hash: codeHash,
    p_client_ip: clientIp(req),
  });
  if (redeemed.error) {
    const codeName = knownCode(redeemed.error, 'invalid_input');
    const status = codeName === 'not_authorized' ? 403 : 400;
    return json({ error: codeName }, status);
  }
  const row = redeemed.data && typeof redeemed.data === 'object' ? (redeemed.data as { error?: unknown }) : {};
  if (typeof row.error === 'string') {
    const codeName = knownCode(row.error, 'invalid_input');
    const status = codeName === 'not_authorized' ? 403 : 400;
    return json({ error: codeName }, status);
  }
  return json(redeemed.data ?? {});
});
