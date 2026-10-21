import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { spawnSync } from 'node:child_process';
import {
  JOIN_ALPHABET,
  JOIN_WEB_ORIGIN,
  formatJoinCode,
  hmacSha256Hex,
  isJoinCodeShape,
  joinFailureMessage,
  joinShareText,
  loadSecretKey,
  normalizeJoinCode,
  passwordHasLettersAndDigits,
  ipRateSubject,
  platformClientIp,
  publicCodePath,
  resetShareText,
} from './joinCodes.ts';

const migration = fs.readFileSync(new URL('../supabase/migrations/20261021210000_join_codes.sql', import.meta.url), 'utf8');

test('codes are normalised, formatted, and shared without a pepper in the client', () => {
  assert.equal(JOIN_ALPHABET.length, 31);
  assert.equal(/[0OIL1]/.test(JOIN_ALPHABET), false);
  assert.equal(normalizeJoinCode(' k7qm-4xpr '), 'K7QM4XPR');
  assert.equal(formatJoinCode('k7qm 4xpr'), 'K7QM-4XPR');
  assert.equal(isJoinCodeShape('K7QM-4XPR'), true);
  assert.equal(isJoinCodeShape('K7QM-0XPR'), false);
  assert.equal(passwordHasLettersAndDigits('letters1'), true);
  assert.equal(passwordHasLettersAndDigits('lettersonly'), false);
  assert.equal(passwordHasLettersAndDigits('12345678'), false);
  assert.equal(passwordHasLettersAndDigits('short1'), false);
  const shared = joinShareText({ company: 'HolmesCP', site: 'Morpeth', code: 'K7QM-4XPR' });
  const resetShared = resetShareText('Sam Reed', 'K7QM-4XPR');
  assert.equal(
    shared,
    `Join HolmesCP on SitePack for Morpeth: ${JOIN_WEB_ORIGIN}/join/K7QM4XPR Code: K7QM-4XPR`
  );
  assert.equal(
    resetShared,
    `SitePack password reset for Sam Reed: ${JOIN_WEB_ORIGIN}/reset/K7QM4XPR Code: K7QM-4XPR. It lasts 30 minutes and works once.`
  );
  assert.equal(shared.includes('  '), false);
  assert.equal(resetShared.includes('  '), false);
  assert.equal(publicCodePath('/join/K7QM4XPR'), '/join');
  assert.equal(publicCodePath('/reset/K7QM4XPR'), '/reset');
  assert.equal(publicCodePath('/join'), null);
  assert.equal(joinFailureMessage('join_rejected'), joinFailureMessage('nope'));
});

test('client IP uses CF-Connecting-IP or a from-right X-Forwarded-For hop', () => {
  const headers = {
    get(name: string) {
      if (name === 'x-forwarded-for') return '1.1.1.1, 198.51.100.8, 203.0.113.9';
      if (name === 'x-real-ip') return '9.9.9.9';
      if (name === 'cf-connecting-ip') return '203.0.113.50';
      return null;
    },
  };
  assert.equal(platformClientIp(headers), '203.0.113.50');
  assert.equal(platformClientIp(headers, 'cf-connecting-ip'), '203.0.113.50');
  assert.equal(platformClientIp(headers, 'x-forwarded-for:from-right:1'), '203.0.113.9');
  assert.equal(platformClientIp(headers, 'x-forwarded-for:from-right:2'), '198.51.100.8');
  assert.notEqual(platformClientIp(headers, 'x-forwarded-for:from-right:1'), '1.1.1.1');
  const noCf = {
    get(name: string) {
      if (name === 'x-forwarded-for') return '1.1.1.1, 203.0.113.9';
      if (name === 'x-real-ip') return '9.9.9.9';
      return null;
    },
  };
  assert.equal(platformClientIp(noCf), '203.0.113.9');
  assert.equal(platformClientIp({ get: () => null }), 'unknown');
  assert.equal(ipRateSubject('2001:db8:1:2::1'), ipRateSubject('2001:0db8:0001:0002::99'));
  assert.notEqual(ipRateSubject('2001:db8:1:2::1'), ipRateSubject('2001:db8:1:3::1'));
  assert.equal(ipRateSubject('203.0.113.9'), '203.0.113.9');
  assert.equal(ipRateSubject('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipRateSubject('0:0:0:0:0:ffff:198.51.100.8'), '198.51.100.8');
  assert.equal(ipRateSubject('::ffff:999.1.1.1'), 'unknown');
  assert.equal(ipRateSubject('not-an-ip'), 'unknown');
});

test('the secret key loader fails closed and does not read another key', () => {
  assert.deepEqual(loadSecretKey(undefined), { ok: false, error: 'secret_key_missing' });
  assert.deepEqual(loadSecretKey('not-json'), { ok: false, error: 'secret_key_missing' });
  assert.deepEqual(loadSecretKey('{"default":"service_role_key"}'), { ok: false, error: 'secret_key_missing' });
  assert.deepEqual(loadSecretKey('{"other":"sb_secret_abc"}'), { ok: false, error: 'secret_key_missing' });
  assert.deepEqual(loadSecretKey('{"default":"sb_secret_test_value"}'), {
    ok: true,
    key: 'sb_secret_test_value',
  });
  const http = fs.readFileSync(new URL('../supabase/functions/_shared/joinHttp.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(http, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(http, /SUPABASE_SECRET_KEYS/);
  assert.match(http, /secret_key_missing/);
});

test('web crypto hmac matches the probe vector', async () => {
  const hex = await hmacSha256Hex('K7QM4XPR', 'probe-pepper');
  assert.equal(hex, '1710b797362358fd1e6f14ec85f07f2565263eeeb333cc5782717326a847257c');
});

test('the migration locks the code, hides the hash, and does not commit a pepper', () => {
  assert.match(migration, /for update/);
  assert.doesNotMatch(migration, /extensions\.hmac/);
  assert.doesNotMatch(migration, /app\.join_code_pepper/);
  assert.doesNotMatch(migration, /JOIN_CODE_PEPPER/);
  assert.doesNotMatch(migration, /pepper_not_configured/);
  assert.match(migration, /revoke all on function public\.apply_join_code\(text, uuid, text, text, text, text, text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.apply_join_code\(text, uuid, text, text, text, text, text\) to service_role/);
  assert.match(migration, /request\.jwt\.claims/);
  assert.match(migration, /'service_role'/);
  assert.match(migration, /'operative'/);
  assert.match(migration, /interval '15 minutes', 10/);
  assert.match(migration, /v_count = 100/);
  assert.match(migration, /v_count = 40/);
  assert.match(migration, /interval '30 minutes'/);
  assert.match(migration, /email_change_blocked/);
  assert.match(migration, /@users\.sitepack\.invalid/);
  assert.match(migration, /archived_at is not null/);
  assert.equal(/grant select \([^)]*code_hash/.test(migration), false);
  assert.equal(/grant select \(username\)/.test(migration), false);
  assert.equal(migration.includes('probe-pepper'), false);
  const join = fs.readFileSync(new URL('../components/join-screen.tsx', import.meta.url), 'utf8');
  const joined = fs.readFileSync(new URL('../app/(app)/sites/[siteId]/joined.tsx', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../app/+html.tsx', import.meta.url), 'utf8');
  assert.match(join, /publicCodePath/);
  assert.match(join, /history\.replaceState/);
  assert.doesNotMatch(join, /company_name|site_name/);
  assert.match(joined, /Also revoke this code/);
  assert.match(joined, /can’t pull them back/);
  assert.match(joined, /Remove \$\{pending\.display_name \|\| 'them'\} from the company\?/);
  assert.match(joined, /Remove \$\{pending\.display_name \|\| 'them'\} from this site\?/);
  assert.match(html, /no-referrer/);
  assert.match(migration, /reset_release/);
  assert.match(migration, /rate_limited/);
  assert.match(migration, /username_is_taken\(text, text, text\)/);
  assert.match(migration, /drop function if exists public\.username_is_taken\(text\)/);
  assert.doesNotMatch(migration, /grant execute on function public\.username_is_taken\(text\) /);
  assert.doesNotMatch(migration, /'reset_code'/);
  const invite = fs.readFileSync(
    new URL('../app/(app)/sites/[siteId]/invite-code.tsx', import.meta.url),
    'utf8'
  );
  assert.match(invite, /createJoinCode[\s\S]*revokeJoinCode\(row\.id\)/);
  const vercel = fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
  assert.match(vercel, /\/join/);
  assert.match(vercel, /\/reset/);
  assert.match(vercel, /no-referrer/);
  const supabaseLib = fs.readFileSync(new URL('../lib/supabase.ts', import.meta.url), 'utf8');
  assert.match(supabaseLib, /export const useFixtures = process\.env\.EXPO_PUBLIC_USE_FIXTURES === '1';/);
  const login = fs.readFileSync(new URL('../app/(auth)/login.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(login, /from '@\/data\/ids'/);
  assert.doesNotMatch(login, /amy@sitepack\.test/);
});

test('a production web export refuses to start without Supabase env', () => {
  const result = spawnSync(process.execPath, ['scripts/export-web.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr ?? '', /EXPO_PUBLIC_SUPABASE_URL/);
});

test('a code joins only its site, the cap holds, and bad codes look the same', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const rio = await fixtureRepo.addNoLoginOperative({ displayName: 'Rio Kent', siteIds: [IDS.riverside] });
  const created = await fixtureRepo.createJoinCode({
    siteId: IDS.oak,
    label: 'Oak fixers',
    maxUses: 3,
    hours: 24,
  });
  const listed = await fixtureRepo.listJoinCodes(IDS.oak);
  assert.equal(JSON.stringify(listed).includes(created.code.replace('-', '')), false);
  assert.equal(JSON.stringify(listed).includes('code_hash'), false);
  assert.equal(listed[0]?.label, 'Oak fixers');
  assert.equal(listed[0]?.max_uses, 3);

  const joined = [];
  for (const name of ['samreed', 'leejoin', 'niajoin']) {
    const result = await fixtureRepo.joinWithCode({
      code: created.code,
      displayName: name,
      trade: 'fixer',
      username: name,
      password: 'fixer123',
    });
    joined.push(result);
    assert.equal(result.siteId, IDS.oak);
    assert.equal(result.person.company_id, IDS.company);
    assert.equal(result.person.role, 'operative');
    assert.equal(result.person.email, null);
    const sites = await fixtureRepo.listAssignedSites();
    assert.deepEqual(sites.map((site) => site.id), [IDS.oak]);
    const visible = await fixtureRepo.listCompanyPeople();
    assert.equal(visible.some((person) => person.id === rio), false);
    assert.equal(visible.every((person) => person.email == null && person.phone == null), true);
    await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  }

  await assert.rejects(
    () =>
      fixtureRepo.joinWithCode({
        code: created.code,
        displayName: 'Fourth',
        trade: 'fixer',
        username: 'fourthlad',
        password: 'fixer123',
      }),
    /join_rejected/
  );

  const wrong = await fixtureRepo
    .joinWithCode({
      code: 'ZZZZ-ZZZZ',
      displayName: 'Nope',
      trade: 'fixer',
      username: 'nopeuser',
      password: 'fixer123',
    })
    .catch((error: Error) => error.message);
  await fixtureRepo.revokeJoinCode(created.id);
  const revoked = await fixtureRepo
    .joinWithCode({
      code: created.code,
      displayName: 'Nope',
      trade: 'fixer',
      username: 'nopeuser',
      password: 'fixer123',
    })
    .catch((error: Error) => error.message);
  assert.equal(wrong, 'join_rejected');
  assert.equal(revoked, wrong);

  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.issuePasswordReset(IDS.owner), /not_authorized/);
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const first = await fixtureRepo.issuePasswordReset(joined[0].person.id);
  const second = await fixtureRepo.issuePasswordReset(joined[0].person.id);
  await assert.rejects(() => fixtureRepo.redeemPasswordReset(first.code, 'newer123'), /reset_rejected/);
  await fixtureRepo.redeemPasswordReset(second.code, 'newer123');
  await assert.rejects(() => fixtureRepo.redeemPasswordReset(second.code, 'newer123'), /reset_rejected/);

  await fixtureRepo.removeJoiner(joined[1].person.id, IDS.oak, true);
  await assert.rejects(
    () => fixtureRepo.signInWithUsername(joined[1].person.username ?? '', 'fixer123'),
    /sign_in_failed/
  );
  const stillThere = (await fixtureRepo.listAssignments(IDS.oak)).some((row) => row.person_id === joined[1].person.id);
  assert.equal(stillThere, false);

  await fixtureRepo.signOut();
  await fixtureRepo.signInWithUsername(joined[0].person.username ?? '', 'newer123');
  assert.equal((await fixtureRepo.me())?.id, joined[0].person.id);
  await fixtureRepo.signOut();
  await assert.rejects(
    () => fixtureRepo.signInWithUsername(joined[0].person.username ?? '', 'fixer123'),
    /sign_in_failed/
  );

  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const firstCode = await fixtureRepo.createJoinCode({
    siteId: IDS.riverside,
    label: 'Riverside again',
    maxUses: 4,
    hours: 24,
  });
  const replacement = await fixtureRepo.createJoinCode({
    siteId: IDS.riverside,
    label: 'Riverside again',
    maxUses: 4,
    hours: 24,
  });
  await fixtureRepo.revokeJoinCode(firstCode.id);
  const active = (await fixtureRepo.listJoinCodes(IDS.riverside)).filter(
    (row) => row.label === 'Riverside again' && row.revoked_at == null
  );
  assert.equal(active.length, 1);
  assert.equal(active[0]?.id, replacement.id);

  await fixtureRepo.signOut();
  await fixtureRepo.signInWithUsername('bentorres', SEED_PASSWORD);
  assert.equal((await fixtureRepo.me())?.id, IDS.ben);
});

test('owner reset lets the username sign in with the new password only once', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const issued = await fixtureRepo.issuePasswordReset(IDS.ben);
  await fixtureRepo.signOut();
  await fixtureRepo.redeemPasswordReset(issued.code, 'newer123');
  const signedIn = await fixtureRepo.signInWithUsername('bentorres', 'newer123');
  assert.equal(signedIn.person.id, IDS.ben);
  await fixtureRepo.signOut();
  await assert.rejects(() => fixtureRepo.signInWithUsername('bentorres', SEED_PASSWORD), /sign_in_failed/);
  await assert.rejects(() => fixtureRepo.redeemPasswordReset(issued.code, 'newer456'), /reset_rejected/);
});
