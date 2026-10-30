import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { canOfferSiteManagerChange, siteManagerChange } from './companyPeople.ts';
import { fixtureRepo, resetFixtureStore, roleAuditForTests } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { canManageSite } from './repo.ts';

test('site manager menu is owner only and names the person and the change', () => {
  const make = siteManagerChange('operative');
  const remove = siteManagerChange('cm');
  assert.equal(siteManagerChange('owner'), null);
  assert.equal(make?.label, 'Make site manager');
  assert.equal(make?.next, 'cm');
  assert.equal(
    make?.confirm('Jordan'),
    'Jordan will be able to upload and replace drawings on their sites.',
  );
  assert.equal(remove?.label, 'Remove site manager');
  assert.equal(remove?.next, 'operative');
  assert.equal(
    remove?.confirm('Jordan'),
    'Jordan will no longer be able to upload or replace drawings on their sites.',
  );
  assert.equal(canOfferSiteManagerChange('owner', IDS.owner, { id: IDS.amy, role: 'operative' }), true);
  assert.equal(canOfferSiteManagerChange('owner', IDS.owner, { id: IDS.cm, role: 'cm' }), true);
  assert.equal(canOfferSiteManagerChange('owner', IDS.owner, { id: IDS.owner, role: 'owner' }), false);
  assert.equal(canOfferSiteManagerChange('cm', IDS.cm, { id: IDS.amy, role: 'operative' }), false);
  assert.equal(canOfferSiteManagerChange('operative', IDS.amy, { id: IDS.cm, role: 'cm' }), false);
  assert.equal(canOfferSiteManagerChange('owner', IDS.owner, { id: IDS.owner, role: 'operative' }), false);

  const screen = fs.readFileSync('app/(app)/people.tsx', 'utf8');
  assert.match(screen, /canOfferSiteManagerChange\(person\.role, person\.id, row\)/);
  assert.match(screen, /change\.confirm\(personLabel\(row\)\)/);
  assert.match(screen, /minHeight=\{change\.next === 'cm' \? 56 : 48\}/);
  assert.doesNotMatch(screen, /sign in again|log in again|sign out and back/i);
});

test('the owner promotes a member who can upload, then demotion removes upload', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  assert.equal((await fixtureRepo.me())?.role, 'operative');
  await assert.rejects(
    () =>
      fixtureRepo.replaceDrawing({
        siteId: IDS.oak,
        title: 'Before',
        revision: 'A',
        storagePath: `${IDS.company}/${IDS.oak}/before.pdf`,
      }),
    /not_authorized/,
  );
  await assert.rejects(() => fixtureRepo.setPersonRole(IDS.cm, 'operative'), /not_authorized/);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.setPersonRole(IDS.amy, 'cm'), /not_authorized/);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.setPersonRole(IDS.owner, 'operative'), /not_authorized/);
  await assert.rejects(() => fixtureRepo.setPersonRole(IDS.amy, 'operative'), /not_authorized/);
  await assert.rejects(() => fixtureRepo.setPersonRole(IDS.amy, 'owner' as 'cm'), /not_authorized/);

  await fixtureRepo.setPersonRole(IDS.amy, 'cm');
  const promoted = roleAuditForTests();
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0]?.actor_id, IDS.owner);
  assert.equal(promoted[0]?.person_id, IDS.amy);
  assert.equal(promoted[0]?.old_role, 'operative');
  assert.equal(promoted[0]?.new_role, 'cm');
  assert.equal(typeof promoted[0]?.created_at, 'string');

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const manager = await fixtureRepo.me();
  assert.equal(manager?.role, 'cm');
  assert.equal(manager ? canManageSite(manager.role) : false, true);
  const uploaded = await fixtureRepo.replaceDrawing({
    siteId: IDS.oak,
    title: 'Amy sheet',
    revision: 'A',
    storagePath: `${IDS.company}/${IDS.oak}/amy-sheet.pdf`,
  });
  assert.equal(uploaded.uploaded_by, IDS.amy);
  assert.equal(uploaded.is_current, true);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.setPersonRole(IDS.amy, 'operative');
  const demoted = roleAuditForTests();
  assert.equal(demoted.length, 2);
  assert.equal(demoted[1]?.old_role, 'cm');
  assert.equal(demoted[1]?.new_role, 'operative');
  assert.equal(demoted[1]?.actor_id, IDS.owner);
  assert.equal(demoted[1]?.person_id, IDS.amy);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  assert.equal((await fixtureRepo.me())?.role, 'operative');
  assert.equal(canManageSite('operative'), false);
  await assert.rejects(
    () =>
      fixtureRepo.replaceDrawing({
        siteId: IDS.oak,
        title: 'Amy sheet gone',
        revision: 'A',
        storagePath: `${IDS.company}/${IDS.oak}/amy-gone.pdf`,
      }),
    /not_authorized/,
  );
});

test('set_person_role is born with an empty search_path and the app reloads the person', () => {
  const sql = fs.readFileSync('supabase/migrations/20261030141600_set_person_role.sql', 'utf8');
  assert.match(sql, /function public\.set_person_role\(p_person_id uuid, p_role text\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /revoke all on function public\.set_person_role\(uuid, text\) from public, anon/);
  assert.match(sql, /grant execute on function public\.set_person_role\(uuid, text\) to authenticated/);
  assert.match(sql, /public\.person_role_audit/);
  assert.match(sql, /private\.my_role\(\) = 'owner'/);
  assert.doesNotMatch(sql, /app\.json|versionCode/);

  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  assert.match(auth, /AppState\.addEventListener\('change'/);
  assert.match(auth, /next === 'active'/);
  assert.match(auth, /repo\.me\(\)/);
  assert.match(fs.readFileSync('app/(app)/sites/index.tsx', 'utf8'), /void refresh\(\)/);
  assert.match(fs.readFileSync('app/(app)/sites/[siteId]/index.tsx', 'utf8'), /void refresh\(\)/);
  assert.match(fs.readFileSync('data/supabaseRepo.ts', 'utf8'), /rpc\('set_person_role'/);
  assert.equal(fs.readFileSync('package.json', 'utf8').includes('"version": "0.2.13"'), true);
});
