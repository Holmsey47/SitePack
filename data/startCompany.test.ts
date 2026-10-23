import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { gateRedirect } from '../lib/authGate.ts';
import { fixtureRepo, peopleWithEmailForTests, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import {
  CHECK_YOUR_EMAIL,
  inviteIsExistingAccount,
  parseStartCompany,
  START_EMAIL_LIMIT,
  startCompanyResult,
  startFailureMessage,
} from './startCompany.ts';
import { DEFAULT_START_REDIRECT, startRedirect } from '../supabase/functions/_shared/startCompany.ts';

test('start company trims names and lowercases email', () => {
  assert.deepEqual(parseStartCompany({ companyName: '  Acme  ', fullName: '  Ada Owner  ', email: '  Ada@Example.com  ' }), {
    ok: true,
    companyName: 'Acme',
    fullName: 'Ada Owner',
    email: 'ada@example.com',
  });
  assert.deepEqual(parseStartCompany({ companyName: 'A', fullName: 'B', email: 'a@b.co' }), {
    ok: true,
    companyName: 'A',
    fullName: 'B',
    email: 'a@b.co',
  });
  assert.equal(parseStartCompany({ companyName: 'A'.repeat(80), fullName: 'B'.repeat(80), email: 'a@b.co' }).ok, true);
  for (const input of [
    { companyName: '   ', fullName: 'Ada', email: 'a@b.co' },
    { companyName: 'A'.repeat(81), fullName: 'Ada', email: 'a@b.co' },
    { companyName: 'Acme', fullName: '   ', email: 'a@b.co' },
    { companyName: 'Acme', fullName: 'B'.repeat(81), email: 'a@b.co' },
    { companyName: 'Acme', fullName: 'Ada', email: 'not-an-email' },
    { companyName: 'Acme', fullName: 'Ada', email: 'a@b' },
    { companyName: 'Acme', fullName: 'Ada', email: `${'a'.repeat(250)}@b.co` },
    { companyName: 1, fullName: 'Ada', email: 'a@b.co' },
    { companyName: 'Acme', fullName: null, email: 'a@b.co' },
  ]) {
    assert.deepEqual(parseStartCompany(input), { ok: false });
  }
});

test('a new invite and an existing email share one check-your-email response', () => {
  const created = startCompanyResult({ valid: true, limited: false, invite: 'created', bootstrap: 'ok' });
  const exists = startCompanyResult({ valid: true, limited: false, invite: 'exists', bootstrap: 'skipped' });
  const already = startCompanyResult({
    valid: true,
    limited: false,
    invite: 'created',
    bootstrap: 'already_has_person',
  });
  assert.deepEqual(created, exists);
  assert.deepEqual(already.body, created.body);
  assert.equal(already.deleteUser, false);
  assert.deepEqual(created.body, { ok: true, message: CHECK_YOUR_EMAIL });
  assert.equal(created.status, 200);
  assert.equal(created.deleteUser, false);

  const failed = startCompanyResult({ valid: true, limited: false, invite: 'created', bootstrap: 'failed' });
  assert.equal(failed.status, 500);
  assert.equal(failed.deleteUser, true);
  assert.deepEqual(failed.body, { error: 'start_failed' });

  const inviteFailed = startCompanyResult({ valid: true, limited: false, invite: 'failed', bootstrap: 'skipped' });
  assert.equal(inviteFailed.deleteUser, false);
  assert.equal(inviteFailed.status, 500);

  assert.deepEqual(startCompanyResult({ valid: false, limited: true, invite: 'skipped', bootstrap: 'skipped' }).body, {
    error: 'invalid_input',
  });
  assert.equal(
    startCompanyResult({ valid: true, limited: true, invite: 'skipped', bootstrap: 'skipped' }).status,
    429
  );
  assert.equal(startFailureMessage('rate_limited'), 'Too many tries. Wait a few minutes.');
  assert.equal(startFailureMessage('nope'), 'Could not start the company. Try again.');
});

test('existing-account invite errors are recognised without treating every failure as one', () => {
  assert.equal(inviteIsExistingAccount({ code: 'email_exists', message: 'nope' }), true);
  assert.equal(inviteIsExistingAccount({ message: 'A user with this email address has already been registered' }), true);
  assert.equal(inviteIsExistingAccount({ code: 'unexpected_failure', message: 'smtp down' }), false);
  assert.equal(inviteIsExistingAccount(null), false);
  assert.equal(inviteIsExistingAccount('already registered'), false);
});

test('an unset invite redirect uses the preview set-password URL', () => {
  assert.equal(DEFAULT_START_REDIRECT, 'https://sitepack-preview.vercel.app/set-password');
  assert.equal(startRedirect(undefined), DEFAULT_START_REDIRECT);
  assert.equal(startRedirect('   '), DEFAULT_START_REDIRECT);
  assert.equal(startRedirect('http://127.0.0.1:8081/set-password'), 'http://127.0.0.1:8081/set-password');
  assert.equal(startRedirect('https://sitepack-preview.vercel.app/set-password'), DEFAULT_START_REDIRECT);
  assert.equal(startRedirect('http://example.com/set-password'), null);
});

test('signed-out people land on welcome and can open start, login, join, and reset', () => {
  const signedOut = { ready: true, hasPerson: false, needsPassword: false };
  assert.equal(gateRedirect({ ...signedOut, segments: [] }), '/welcome');
  assert.equal(gateRedirect({ ...signedOut, segments: ['(app)', 'sites'] }), '/welcome');
  for (const segments of [
    ['(auth)', 'welcome'],
    ['(auth)', 'start'],
    ['(auth)', 'login'],
    ['join'],
    ['join', 'AB12'],
    ['reset'],
    ['reset', 'AB12'],
  ]) {
    assert.equal(gateRedirect({ ...signedOut, segments }), null, segments.join('/'));
  }
  assert.equal(
    gateRedirect({ ready: true, hasPerson: true, needsPassword: true, segments: ['(auth)', 'login'] }),
    '/set-password'
  );
  assert.equal(
    gateRedirect({ ready: true, hasPerson: true, needsPassword: true, segments: ['(auth)', 'start'] }),
    '/set-password'
  );
  assert.equal(
    gateRedirect({ ready: true, hasPerson: true, needsPassword: true, segments: ['(auth)', 'set-password'] }),
    null
  );
  assert.equal(
    gateRedirect({ ready: true, hasPerson: true, needsPassword: false, segments: ['(auth)', 'welcome'] }),
    '/sites'
  );
  assert.equal(
    gateRedirect({ ready: true, hasPerson: true, needsPassword: false, segments: ['(app)', 'sites'] }),
    null
  );
  assert.equal(gateRedirect({ ready: false, hasPerson: false, needsPassword: false, segments: [] }), null);

  const index = fs.readFileSync('app/index.tsx', 'utf8');
  assert.match(index, /Redirect href="\/welcome"/);
  assert.doesNotMatch(index, /Redirect href="\/login"/);
  const welcome = fs.readFileSync('app/(auth)/welcome.tsx', 'utf8');
  assert.match(welcome, /Start my company/);
  assert.match(welcome, /I've got an invite/);
  assert.match(welcome, /router\.push\('\/join'\)/);
  assert.match(welcome, /Log in/);
  assert.match(welcome, /router\.push\('\/login'\)/);
  assert.equal(welcome.split('minHeight={48}').length - 1, 3);
  const start = fs.readFileSync('app/(auth)/start.tsx', 'utf8');
  assert.match(start, /Company name/);
  assert.match(start, /Your name/);
  assert.match(start, /CHECK_YOUR_EMAIL/);
  assert.equal(welcome.includes('service_role'), false);
  assert.equal(start.includes('service_role'), false);
});

test('the fixture data layer returns the same message and one company per new email', async () => {
  resetFixtureStore();
  await fixtureRepo.signOut();
  const first = await fixtureRepo.startCompany({
    companyName: '  North Drylining  ',
    fullName: '  Bea Owner  ',
    email: '  Bea@Example.com ',
  });
  const second = await fixtureRepo.startCompany({
    companyName: 'Other Co',
    fullName: 'Bea Owner',
    email: 'bea@example.com',
  });
  assert.equal(first.message, CHECK_YOUR_EMAIL);
  assert.deepEqual(second, first);
  assert.equal(peopleWithEmailForTests('bea@example.com'), 1);
  assert.equal(await fixtureRepo.me(), null);
  const session = await fixtureRepo.signIn('bea@example.com', SEED_PASSWORD);
  assert.equal(session.person.role, 'owner');
  assert.equal(session.person.display_name, 'Bea Owner');
  assert.equal(session.person.email, 'bea@example.com');
  assert.equal(session.person.auth_user_id, session.person.id);
  assert.notEqual(session.person.company_id, IDS.company);
  await fixtureRepo.signOut();

  const existing = await fixtureRepo.startCompany({
    companyName: 'Ashfield Again',
    fullName: 'Jordan Hale',
    email: 'owner@sitepack.test',
  });
  assert.equal(existing.message, CHECK_YOUR_EMAIL);
  assert.equal(peopleWithEmailForTests('owner@sitepack.test'), 1);
  const owner = await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  assert.equal(owner.person.company_id, IDS.company);
  await fixtureRepo.signOut();

  await assert.rejects(
    () => fixtureRepo.startCompany({ companyName: '  ', fullName: 'Ada', email: 'ada@example.com' }),
    /invalid_input/
  );
  assert.equal(peopleWithEmailForTests('ada@example.com'), 0);
  const third = await fixtureRepo.startCompany({
    companyName: 'North Drylining',
    fullName: 'Bea Owner',
    email: 'bea@example.com',
  });
  assert.equal(third.message, CHECK_YOUR_EMAIL);
  assert.equal(START_EMAIL_LIMIT, 3);
  await assert.rejects(
    () =>
      fixtureRepo.startCompany({
        companyName: 'North Drylining',
        fullName: 'Bea Owner',
        email: 'bea@example.com',
      }),
    /rate_limited/
  );
  assert.equal(peopleWithEmailForTests('bea@example.com'), 1);
  resetFixtureStore();
});

test('owner start is service role only, and the app does not insert companies', () => {
  const sql = fs.readFileSync('supabase/migrations/20261023160000_start_company.sql', 'utf8');
  assert.match(sql, /function public\.bootstrap_owner\(\s*p_user_id uuid,\s*p_company_name text,\s*p_full_name text\s*\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /revoke all on function public\.bootstrap_owner\(uuid, text, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.bootstrap_owner\(uuid, text, text\) to service_role/);
  assert.match(sql, /revoke all on function public\.claim_start_company\(text, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.claim_start_company\(text, text\) to service_role/);
  assert.match(sql, /'owner_start'/);
  assert.match(sql, /interval '1 hour', 3/);
  assert.match(sql, /interval '1 hour', 8/);
  assert.match(sql, /drop policy if exists companies_insert_owner on public\.companies/);
  assert.match(sql, /insert into public\.people \(id, auth_user_id, company_id, role, display_name, email\)/);
  assert.match(sql, /'owner'/);
  assert.doesNotMatch(sql, /enable_signup/);

  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  assert.match(repo, /invokePublicFunction\('start-company'/);
  assert.doesNotMatch(repo, /bootstrap_owner/);
  assert.doesNotMatch(repo, /from\('companies'\)\.insert/);
  assert.equal(repo.includes('service_role'), false);
  assert.equal(fs.readFileSync('data/startCompany.ts', 'utf8').includes('service_role'), false);
  assert.equal(fs.readFileSync('supabase/functions/_shared/startCompany.ts', 'utf8').includes('service_role'), false);

  const fn = fs.readFileSync('supabase/functions/start-company/index.ts', 'utf8');
  assert.match(fn, /inviteUserByEmail\(parsed\.email, \{ redirectTo \}\)/);
  assert.match(fn, /bootstrap_owner/);
  assert.match(fn, /claim_start_company/);
  assert.match(fn, /deleteUser\(userId\)/);
  assert.match(fn, /startCompanyResult/);
  assert.match(fn, /startRedirect\(Deno\.env\.get\('INVITE_REDIRECT_URL'\)\)/);
  for (const log of fn.match(/console\.error\([\s\S]*?\);/g) ?? []) {
    assert.equal(log.includes('parsed'), false, log);
    assert.equal(log.includes('email'), false, log);
  }

  const toml = fs.readFileSync('supabase/config.toml', 'utf8');
  assert.match(toml, /\[functions\.start-company\]\s*verify_jwt = false/);
  const auth = toml.split('[auth.email]')[0] ?? '';
  assert.match(auth, /enable_signup = false/);

  const probe = fs.readFileSync('scripts/start-company.sql', 'utf8');
  assert.match(probe, /has_function_privilege\('anon', 'public\.bootstrap_owner\(uuid, text, text\)', 'execute'\)/);
  assert.match(probe, /has_function_privilege\('service_role', 'public\.bootstrap_owner\(uuid, text, text\)', 'execute'\)/);
  assert.match(fs.readFileSync('scripts/run-snag-rls.sh', 'utf8'), /scripts\/start-company\.sql/);
  assert.match(fs.readFileSync('scripts/live-company.mjs', 'utf8'), /deployArgs\(ref, 'start-company'\)/);
});
