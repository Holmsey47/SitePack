import { passwordHasLettersAndDigits } from '../_shared/joinCodes.ts';
import { clientIp, hashCode, json, pepperOrNull, preflight, readResult, serviceClient } from '../_shared/joinHttp.ts';

/**
 * The person sets the new password. verify_jwt is false.
 * Sessions are cleared by redeem_password_reset. This function does not
 * return a session. The caller signs in with their username afterwards.
 */
Deno.serve(async (req) => {
  const early = preflight(req);
  if (early && req.method === 'OPTIONS') return early;
  if (req.method !== 'POST') return json({ error: 'reset_rejected' }, 405);

  const pepper = pepperOrNull();
  if (!pepper) return json({ error: 'reset_rejected' }, 500);

  let body: { code?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'reset_rejected' }, 400);
  }

  const password = body.password ?? '';
  if (!passwordHasLettersAndDigits(password)) {
    return json({ error: 'weak_password' }, 400);
  }

  const ip = clientIp(req);
  const admin = serviceClient(ip);
  if (!admin) return json({ error: 'reset_rejected' }, 500);
  const codeHash = await hashCode(body.code ?? '', pepper);

  const redeemed = await admin.rpc('redeem_password_reset', {
    p_code_hash: codeHash ?? '00',
    p_client_ip: ip,
  });
  const row = readResult(redeemed.data);
  if (row.error === 'rate_limited') return json({ error: 'rate_limited' }, 429);
  if (redeemed.error || !row.ok || !row.auth_user_id || !row.reset_id) {
    return json({ error: 'reset_rejected' }, 400);
  }

  const updated = await admin.auth.admin.updateUserById(row.auth_user_id, { password });
  if (updated.error) {
    await admin.rpc('release_password_reset', { p_reset_id: row.reset_id });
    console.error(JSON.stringify({ error: 'reset_password_failed' }));
    return json({ error: 'reset_rejected' }, 400);
  }

  return json({ ok: true });
});
