import { generateJoinCode } from '../_shared/joinCodes.ts';
import { hashCode, json, knownCode, pepperOrNull, preflight, readResult, userClient } from '../_shared/joinHttp.ts';

/**
 * Logged-in reset-code issue. verify_jwt is true.
 * The plaintext is returned once. SQL stores the hash and checks who may reset whom.
 */
Deno.serve(async (req) => {
  const early = preflight(req);
  if (early && req.method === 'OPTIONS') return early;
  if (req.method !== 'POST') return json({ error: 'not_authorized' }, 405);

  const pepper = pepperOrNull();
  if (!pepper) return json({ error: 'reset_rejected' }, 500);

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'not_authorized' }, 401);
  }

  let body: { person_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'reset_rejected' }, 400);
  }

  const user = userClient(req);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateJoinCode();
    const codeHash = await hashCode(code, pepper);
    const created = await user.rpc('reset_password_code', {
      p_person_id: body.person_id,
      p_code_hash: codeHash,
    });
    if (created.error) {
      const codeName = knownCode(created.error, 'reset_rejected');
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

  return json({ error: 'reset_rejected' }, 400);
});
