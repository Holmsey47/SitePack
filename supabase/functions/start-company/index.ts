import { ipRateSubject, hmacSha256Hex } from '../_shared/joinCodes.ts';
import {
  clientIp,
  errorText,
  json,
  pepperOrNull,
  preflight,
  readResult,
  serviceClient,
} from '../_shared/joinHttp.ts';
import {
  inviteIsExistingAccount,
  parseStartCompany,
  startCompanyResult,
  startRedirect,
} from '../_shared/startCompany.ts';

/**
 * Anonymous owner start. verify_jwt is false.
 * Signup in config stays off. This invites with the service key, then bootstrap_owner.
 * The key never leaves the function. A new email and an existing email both say to check email.
 * If the company row does not stick, the invited user is deleted.
 */
Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(startCompanyResult({ valid: false, limited: false, invite: 'skipped', bootstrap: 'skipped' }).body, 400);
  }
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const parsed = parseStartCompany({
    companyName: record.company_name,
    fullName: record.full_name,
    email: record.email,
  });
  if (!parsed.ok) {
    const rejected = startCompanyResult({ valid: false, limited: false, invite: 'skipped', bootstrap: 'skipped' });
    return json(rejected.body, rejected.status);
  }

  const pepper = pepperOrNull();
  const redirectTo = startRedirect(Deno.env.get('INVITE_REDIRECT_URL'));
  const admin = serviceClient(clientIp(req));
  if (!pepper || !redirectTo || !admin) return json({ error: 'start_failed' }, 500);

  const ipSubject = ipRateSubject(clientIp(req));
  const ipHash = ipSubject === 'unknown' ? null : await hmacSha256Hex(ipSubject, pepper);
  const emailHash = await hmacSha256Hex(parsed.email, pepper);
  const claimed = await admin.rpc('claim_start_company', {
    p_ip_hash: ipHash,
    p_email_hash: emailHash,
  });
  const claimRow = readResult(claimed.data);
  if (claimRow.error === 'rate_limited') {
    const limited = startCompanyResult({ valid: true, limited: true, invite: 'skipped', bootstrap: 'skipped' });
    return json(limited.body, limited.status);
  }
  if (claimed.error || claimRow.ok !== true) {
    console.error(JSON.stringify({ error: 'rate_check_failed' }));
    return json({ error: 'start_failed' }, 500);
  }

  let userId: string | null = null;
  try {
    const invited = await admin.auth.admin.inviteUserByEmail(parsed.email, { redirectTo });
    if (invited.error || !invited.data.user) {
      const invite = inviteIsExistingAccount(invited.error) ? 'exists' : 'failed';
      if (invite === 'failed') console.error(JSON.stringify({ error: 'invite_failed' }));
      const result = startCompanyResult({
        valid: true,
        limited: false,
        invite,
        bootstrap: 'skipped',
      });
      return json(result.body, result.status);
    }

    userId = invited.data.user.id;
    const boot = await admin.rpc('bootstrap_owner', {
      p_user_id: userId,
      p_company_name: parsed.companyName,
      p_full_name: parsed.fullName,
    });
    const bootText = errorText(boot.error);
    const bootstrap = !boot.error && readResult(boot.data).ok === true
      ? 'ok'
      : bootText.includes('already_has_person')
        ? 'already_has_person'
        : 'failed';
    if (bootstrap === 'failed') console.error(JSON.stringify({ error: 'bootstrap_failed' }));

    const result = startCompanyResult({
      valid: true,
      limited: false,
      invite: 'created',
      bootstrap,
    });
    if (result.deleteUser && userId) {
      const removed = await admin.auth.admin.deleteUser(userId);
      if (removed.error) console.error(JSON.stringify({ error: 'delete_user_failed' }));
      userId = null;
    }
    return json(result.body, result.status);
  } catch {
    if (userId) {
      const removed = await admin.auth.admin.deleteUser(userId);
      if (removed.error) console.error(JSON.stringify({ error: 'delete_user_failed' }));
    }
    console.error(JSON.stringify({ error: 'start_failed' }));
    return json({ error: 'start_failed' }, 500);
  }
});
