import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { groupFailureMessage, normalizeGroupName } from './peopleGroups.ts';

test('group name rules and plain failure words', () => {
  assert.equal(normalizeGroupName('  Oak dryliners  '), 'Oak dryliners');
  assert.throws(() => normalizeGroupName('   '), /name_required/);
  assert.throws(() => normalizeGroupName('a'.repeat(41)), /name_too_long/);
  assert.equal(groupFailureMessage('not_authorized'), 'You can’t do that.');
  assert.equal(groupFailureMessage('name_in_use'), 'That group name is already used.');
  assert.equal(groupFailureMessage('person_not_in_company'), 'Choose people from this company.');
  assert.equal(groupFailureMessage('raw database detail'), 'Could not update the group.');
});

test('the fixture crew has five people and one has no login', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const groups = await fixtureRepo.listPeopleGroups();
  const crew = groups.find((group) => group.id === IDS.dryliners);
  assert.ok(crew);
  assert.equal(crew.name, 'Oak dryliners');
  assert.equal(crew.members.length, 5);
  const lee = crew.members.find((member) => member.person_id === IDS.lee);
  assert.equal(lee?.display_name, 'Lee Stone');
  assert.equal(lee?.has_login, false);
  assert.equal(crew.members.filter((member) => member.has_login === false).length, 1);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('ben@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.listPeopleGroups(), /not_authorized/);
  await assert.rejects(() => fixtureRepo.createPeopleGroup('Night shift'), /not_authorized/);
  await assert.rejects(() => fixtureRepo.assignGroupToSites(IDS.dryliners, [IDS.oak]), /not_authorized/);
});

test('a contracts manager cannot assign a group onto a site they are not on', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.createPeopleGroup('CM crew'), /not_authorized/);
  await assert.rejects(() => fixtureRepo.setPeopleGroupMembers(IDS.dryliners, [IDS.cm]), /not_authorized/);
  await assert.rejects(() => fixtureRepo.assignGroupToSites(IDS.dryliners, [IDS.riverside]), /not_authorized/);
  const oak = await fixtureRepo.assignGroupToSites(IDS.dryliners, [IDS.oak]);
  assert.equal(oak.added, 2);
  assert.equal((await fixtureRepo.assignGroupToSites(IDS.dryliners, [IDS.oak])).added, 0);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const riverside = await fixtureRepo.listAssignments(IDS.riverside);
  assert.equal(riverside.some((row) => row.person_id === IDS.lee), false);
  assert.equal(riverside.some((row) => row.person_id === IDS.amy), true);
  const oakRows = await fixtureRepo.listAssignments(IDS.oak);
  assert.equal(oakRows.some((row) => row.person_id === IDS.lee), true);
  assert.equal(oakRows.some((row) => row.person_id === IDS.chris), true);
});

test('cross-company people and sites are rejected and assign stays idempotent', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const before = (await fixtureRepo.listPeopleGroups()).find((group) => group.id === IDS.dryliners);
  await assert.rejects(
    () => fixtureRepo.setPeopleGroupMembers(IDS.dryliners, [IDS.amy, '99999999-9999-9999-9999-999999999999']),
    /person_not_in_company/
  );
  const after = (await fixtureRepo.listPeopleGroups()).find((group) => group.id === IDS.dryliners);
  assert.deepEqual(
    after?.members.map((member) => member.person_id).sort(),
    before?.members.map((member) => member.person_id).sort()
  );
  await assert.rejects(
    () => fixtureRepo.assignGroupToSites(IDS.dryliners, ['99999999-9999-9999-9999-999999999999']),
    /site_not_found/
  );
  await assert.rejects(() => fixtureRepo.assignGroupToSites(IDS.dryliners, []), /site_required/);
  await assert.rejects(() => fixtureRepo.createPeopleGroup('oak dryliners'), /name_in_use/);
});

test('assigning a group shows those sites only, and remove leaves the other sites', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.deletePeopleGroup(IDS.dryliners);
  const plot8 = await fixtureRepo.createSite({ name: 'Plot 8' });
  const plot9 = await fixtureRepo.createSite({ name: 'Plot 9' });
  const spare = await fixtureRepo.createSite({ name: 'Spare yard' });
  const sam = await fixtureRepo.addNoLoginOperative({ displayName: 'Sam Cole', siteIds: [IDS.oak] });
  const groupId = await fixtureRepo.createPeopleGroup('Oak dryliners');
  await fixtureRepo.setPeopleGroupMembers(groupId, [IDS.amy, IDS.ben, IDS.cm, IDS.lee, IDS.chris]);
  const members = (await fixtureRepo.listPeopleGroups()).find((group) => group.id === groupId)?.members ?? [];
  assert.equal(members.length, 5);
  assert.equal(members.find((member) => member.person_id === IDS.lee)?.has_login, false);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('chris@sitepack.test', SEED_PASSWORD);
  assert.deepEqual(await fixtureRepo.listAssignedSites(), []);
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);

  const siteIds = [IDS.oak, IDS.riverside, IDS.warehouse, plot8.id, plot9.id];
  const first = await fixtureRepo.assignGroupToSites(groupId, siteIds);
  assert.ok(first.added > 0);
  const second = await fixtureRepo.assignGroupToSites(groupId, [...siteIds, IDS.oak]);
  assert.equal(second.added, 0);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('chris@sitepack.test', SEED_PASSWORD);
  assert.deepEqual((await fixtureRepo.listAssignedSites()).map((site) => site.id).sort(), [...siteIds].sort());
  assert.equal(await fixtureRepo.getSite(spare.id), null);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const removed = await fixtureRepo.removeGroupFromSite(groupId, IDS.oak);
  assert.equal(removed.removed, 5);
  const oak = await fixtureRepo.listAssignments(IDS.oak);
  assert.equal(oak.some((row) => row.person_id === IDS.amy), false);
  assert.equal(oak.some((row) => row.person_id === IDS.ben), false);
  assert.equal(oak.some((row) => row.person_id === IDS.lee), false);
  assert.equal(oak.some((row) => row.person_id === sam), true);
  const riverside = await fixtureRepo.listAssignments(IDS.riverside);
  assert.equal(riverside.some((row) => row.person_id === IDS.amy), true);
  const warehouse = await fixtureRepo.listAssignments(IDS.warehouse);
  assert.equal(warehouse.some((row) => row.person_id === IDS.lee), true);
  assert.equal(warehouse.some((row) => row.person_id === IDS.chris), true);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('chris@sitepack.test', SEED_PASSWORD);
  const chrisSites = (await fixtureRepo.listAssignedSites()).map((site) => site.id).sort();
  assert.deepEqual(chrisSites, [IDS.riverside, IDS.warehouse, plot8.id, plot9.id].sort());
  assert.equal(chrisSites.includes(spare.id), false);
  assert.equal(chrisSites.includes(IDS.oak), false);
});
