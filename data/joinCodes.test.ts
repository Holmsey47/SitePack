import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import {
  JOIN_ALPHABET,
  JOIN_WEB_ORIGIN,
  formatJoinCode,
  hmacSha256Hex,
  isJoinCodeShape,
  joinFailureMessage,
  joinShareText,
  normalizeJoinCode,
  passwordHasLettersAndDigits,
  platformClientIp,
  publicCodePath,
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
  assert.equal(
    joinShareText({ company: 'HolmesCP', site: 'Morpeth', code: 'K7QM-4XPR' }),
    `Join HolmesCP on SitePack for Morpeth: ${JOIN_WEB_ORIGIN}/join/K7QM4XPR  Code: K7QM-4XPR`
  );
  assert.equal(publicCodePath('/join/K7QM4XPR'), '/join');
  assert.equal(publicCodePath('/reset/K7QM4XPR'), '/reset');
  assert.equal(publicCodePath('/join'), null);
  assert.equal(joinFailureMessage('join_rejected'), joinFailureMessage('nope'));
  const headers = {
    get(name: string) {
      if (name === 'x-forwarded-for') return '1.1.1.1, 203.0.113.9';
      if (name === 'x-real-ip') return '9.9.9.9';
      return null;
    },
  };
  assert.equal(platformClientIp(headers), '203.0.113.9');
});

test('web crypto hmac matches the probe vector', async () => {
  const hex = await hmacSha256Hex('K7QM4XPR', 'probe-pepper');
  assert.equal(hex, '1710b797362358fd1e6f14ec85f07f2565263eeeb333cc5782717326a847257c');
});

test('the migration locks the code, hides the hash, and does not commit a pepper', () => {
  assert.match(migration, /for update/);
  assert.match(migration, /extensions\.hmac/);
  assert.match(migration, /revoke all on function public\.apply_join_code\(text, uuid, text, text, text, text, text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.apply_join_code\(text, uuid, text, text, text, text, text\) to service_role/);
  assert.match(migration, /'operative'/);
  assert.match(migration, /interval '15 minutes'\) >= 10/);
  assert.match(migration, /interval '10 minutes'\) >= 100/);
  assert.match(migration, /interval '30 minutes'/);
  assert.match(migration, /email_change_blocked/);
  assert.match(migration, /@users\.sitepack\.invalid/);
  assert.match(migration, /pepper_not_configured/);
  assert.equal(/grant select \([^)]*code_hash/.test(migration), false);
  assert.equal(migration.includes('probe-pepper'), false);
  const join = fs.readFileSync(new URL('../components/join-screen.tsx', import.meta.url), 'utf8');
  const joined = fs.readFileSync(new URL('../app/(app)/sites/[siteId]/joined.tsx', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../app/+html.tsx', import.meta.url), 'utf8');
  assert.match(join, /publicCodePath/);
  assert.match(join, /history\.replaceState/);
  assert.doesNotMatch(join, /company_name|site_name/);
  assert.match(joined, /Also revoke this code/);
  assert.match(joined, /can’t pull them back/);
  assert.match(html, /no-referrer/);
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
  await fixtureRepo.signInWithUsername('bentorres', SEED_PASSWORD);
  assert.equal((await fixtureRepo.me())?.id, IDS.ben);
});
