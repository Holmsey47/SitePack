import { passwordHasLettersAndDigits, placeholderEmail } from '../_shared/joinCodes.ts';
import {
  clientIp,
  hashCode,
  json,
  pepperOrNull,
  preflight,
  readResult,
  serviceClient,
  userAgent,
  usernameOrNull,
} from '../_shared/joinHttp.ts';

const DUMMY_EMAIL = '00000000-0000-4000-8000-000000000000@users.sitepack.invalid';

/**
 * Public join. verify_jwt is false. The code is the credential.
 * Name, trade, password, and username are checked before the code is.
 * The code is checked before an auth user is created.
 * Placeholder emails are random UUIDs at users.sitepack.invalid.
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
  const trade = (body.trade ?? '').trim();
  if (!username || !displayName || displayName.length > 80 || trade.length > 80) {
    return json({ error: 'invalid_input' }, 400);
  }

  const ip = clientIp(req);
  const admin = serviceClient(ip);

  const taken = await admin.rpc('username_is_taken', { p_username: username });
  if (taken.error) {
    console.error(JSON.stringify({ error: 'username_check_failed' }));
    return json({ error: 'join_rejected' }, 400);
  }
  if (readResult(taken.data).taken) {
    return json({ error: 'username_taken' }, 400);
  }

  const codeHash = await hashCode(body.code ?? '', pepper);
  const preview = await admin.rpc('preview_join_code', {
    p_code_hash: codeHash ?? '00',
    p_client_ip: ip,
  });
  if (preview.error || !readResult(preview.data).ok) {
    return json({ error: 'join_rejected' }, 400);
  }

  const email = placeholderEmail(crypto.randomUUID());
  let userId: string | null = null;

  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      console.error(JSON.stringify({ error: 'create_user_failed' }));
      return json({ error: 'join_rejected' }, 400);
    }
    userId = created.data.user.id;

    const applied = await admin.rpc('apply_join_code', {
      p_code_hash: codeHash,
      p_auth_user_id: userId,
      p_display_name: displayName,
      p_trade: trade || null,
      p_username: username,
      p_client_ip: ip,
      p_user_agent: userAgent(req),
    });

    if (applied.error || !readResult(applied.data).ok) {
      const removed = await admin.auth.admin.deleteUser(userId);
      if (removed.error) console.error(JSON.stringify({ error: 'delete_user_failed' }));
      userId = null;
      return json({ error: 'join_rejected' }, 400);
    }

    const signed = await admin.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) {
      const removed = await admin.auth.admin.deleteUser(userId);
      if (removed.error) console.error(JSON.stringify({ error: 'delete_user_failed' }));
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
      const removed = await admin.auth.admin.deleteUser(userId);
      if (removed.error) console.error(JSON.stringify({ error: 'delete_user_failed' }));
    }
    console.error(JSON.stringify({ error: 'join_failed' }));
    return json({ error: 'join_rejected' }, 400);
  }
});
