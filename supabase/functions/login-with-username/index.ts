import { passwordHasLettersAndDigits } from '../_shared/joinCodes.ts';
import {
  clientIp,
  json,
  padLoginMiss,
  preflight,
  readResult,
  serviceClient,
  usernameOrNull,
} from '../_shared/joinHttp.ts';

const DUMMY_EMAIL = '00000000-0000-4000-8000-000000000000@users.sitepack.invalid';

/**
 * Username sign-in. verify_jwt is false.
 * A miss does a dummy password check so it is not obviously faster than a hit.
 * The placeholder email is resolved here and is not returned.
 */
Deno.serve(async (req) => {
  const early = preflight(req);
  if (early && req.method === 'OPTIONS') return early;
  if (req.method !== 'POST') return json({ error: 'sign_in_failed' }, 405);

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'sign_in_failed' }, 400);
  }

  const username = usernameOrNull(body.username ?? '');
  const password = body.password ?? '';
  if (!username || !passwordHasLettersAndDigits(password)) {
    return json({ error: 'sign_in_failed' }, 400);
  }

  const ip = clientIp(req);
  const admin = serviceClient(ip);

  const looked = await admin.rpc('lookup_username_login', {
    p_username: username,
    p_client_ip: ip,
  });
  const found = readResult(looked.data);
  if (looked.error || !found.ok || !found.auth_user_id) {
    await admin.auth.signInWithPassword({ email: DUMMY_EMAIL, password }).catch(() => undefined);
    await padLoginMiss(password);
    return json({ error: 'sign_in_failed' }, 400);
  }

  const user = await admin.auth.admin.getUserById(found.auth_user_id);
  const email = user.data.user?.email;
  if (!email) {
    await admin.rpc('note_login_failure', { p_username: username, p_client_ip: ip });
    await padLoginMiss(password);
    return json({ error: 'sign_in_failed' }, 400);
  }

  const signed = await admin.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) {
    await admin.rpc('note_login_failure', { p_username: username, p_client_ip: ip });
    await padLoginMiss(password);
    return json({ error: 'sign_in_failed' }, 400);
  }

  return json({
    access_token: signed.data.session.access_token,
    refresh_token: signed.data.session.refresh_token,
    expires_in: signed.data.session.expires_in,
  });
});
