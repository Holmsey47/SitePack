import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { passwordHasLettersAndDigits } from '../../../data/joinCodes.ts';
import { clientIp, json, preflight, readResult, usernameOrNull } from '../_shared/joinHttp.ts';

/**
 * Username sign-in. verify_jwt is false.
 * The placeholder email is resolved here and is not returned.
 * Wrong username and wrong password share one error.
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceKey);
  const anon = createClient(supabaseUrl, anonKey);
  const ip = clientIp(req);

  const looked = await admin.rpc('lookup_username_login', {
    p_username: username,
    p_client_ip: ip,
  });
  const found = readResult(looked.data);
  if (looked.error || !found.ok || !found.auth_user_id) {
    return json({ error: 'sign_in_failed' }, 400);
  }

  const user = await admin.auth.admin.getUserById(found.auth_user_id);
  const email = user.data.user?.email;
  if (!email) {
    await admin.rpc('note_login_failure', { p_client_ip: ip });
    return json({ error: 'sign_in_failed' }, 400);
  }

  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) {
    await admin.rpc('note_login_failure', { p_client_ip: ip });
    return json({ error: 'sign_in_failed' }, 400);
  }

  return json({
    access_token: signed.data.session.access_token,
    refresh_token: signed.data.session.refresh_token,
    expires_in: signed.data.session.expires_in,
  });
});
