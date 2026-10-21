import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { passwordHasLettersAndDigits, placeholderEmail } from '../../../data/joinCodes.ts';
import {
  clientIp,
  hashCode,
  joinClientCode,
  json,
  pepperOrNull,
  preflight,
  readResult,
  userAgent,
  usernameOrNull,
} from '../_shared/joinHttp.ts';

/**
 * Public join. verify_jwt is false. The code is the credential.
 * Placeholder emails are random UUIDs at users.sitepack.invalid, created
 * only here, with email_confirm true. They are never mailed.
 * If the database step fails, the auth user is deleted.
 * GET is not this function. The web page does not validate on load.
 */
Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const pepper = pepperOrNull();
  if (!pepper) return json({ error: 'join_rejected' }, 500);

  let body: {
    code?: string;
    display_name?: string;
    trade?: string | null;
    username?: string;
    password?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }

  const password = body.password ?? '';
  if (!passwordHasLettersAndDigits(password)) {
    return json({ error: 'weak_password' }, 400);
  }

  const username = usernameOrNull(body.username ?? '');
  const displayName = (body.display_name ?? '').trim();
  if (!username || !displayName) {
    return json({ error: 'invalid_input' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceKey);
  const anon = createClient(supabaseUrl, anonKey);

  const codeHash = await hashCode(body.code ?? '', pepper);
  const ip = clientIp(req);
  const email = placeholderEmail(crypto.randomUUID());
  let userId: string | null = null;

  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      console.error(JSON.stringify({ error: 'create_user_failed', code: joinClientCode(created.error) }));
      return json({ error: joinClientCode(created.error) }, 400);
    }
    userId = created.data.user.id;

    const applied = await admin.rpc('apply_join_code', {
      p_code_hash: codeHash ?? '00',
      p_auth_user_id: userId,
      p_display_name: displayName,
      p_trade: body.trade ?? null,
      p_username: username,
      p_client_ip: ip,
      p_user_agent: userAgent(req),
    });

    if (applied.error || !readResult(applied.data).ok) {
      await admin.auth.admin.deleteUser(userId);
      userId = null;
      const code = applied.error ? joinClientCode(applied.error) : (readResult(applied.data).error ?? 'join_rejected');
      const safe = code === 'username_taken' || code === 'invalid_input' || code === 'weak_password' ? code : 'join_rejected';
      return json({ error: safe }, 400);
    }

    const signed = await anon.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) {
      await admin.auth.admin.deleteUser(userId);
      console.error(JSON.stringify({ error: 'join_sign_in_failed' }));
      return json({ error: 'join_rejected' }, 400);
    }

    return json({
      access_token: signed.data.session.access_token,
      refresh_token: signed.data.session.refresh_token,
      expires_in: signed.data.session.expires_in,
      site_id: readResult(applied.data).site_id,
    });
  } catch {
    if (userId) {
      await admin.auth.admin.deleteUser(userId);
    }
    console.error(JSON.stringify({ error: 'join_failed' }));
    return json({ error: 'join_rejected' }, 400);
  }
});
