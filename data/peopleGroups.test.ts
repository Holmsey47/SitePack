import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { readFileSync } from 'node:fs';
import { groupChangeCount, groupFailureMessage, memberRowMark, normalizeGroupName, sameMemberIds, saveChangesLabel, siteRowMark } from './peopleGroups.ts';

test('group name rules and plain failure words', () => {
  assert.equal(normalizeGroupName('  Oak dryliners  '), 'Oak dryliners');
  assert.throws(() => normalizeGroupName('   '), /name_required/);
  assert.throws(() => normalizeGroupName('a'.repeat(41)), /name_too_long/);
  assert.equal(groupFailureMessage('not_authorized'), 'You can’t do that.');
  assert.equal(groupFailureMessage('name_in_use'), 'That group name is already used.');
  assert.equal(groupFailureMessage('person_not_in_company'), 'Choose people from this company.');
  assert.equal(groupFailureMessage('raw database detail'), 'Could not update the group.');
});

test('dirty state counts name and membership changes, and zero stays clean', () => {
  assert.equal(memberRowMark(true), 'In group');
  assert.equal(memberRowMark(false), 'Not in group');
  assert.equal(siteRowMark(true), 'Selected');
  assert.equal(siteRowMark(false), 'Not selected');
  assert.equal(sameMemberIds(['b', 'a'], ['a', 'b']), true);
  assert.equal(sameMemberIds(['a'], ['a', 'b']), false);

  const saved = {
    savedName: 'Oak dryliners',
    draftName: 'Oak dryliners',
    savedMemberIds: ['amy', 'ben', 'lee'],
    draftMemberIds: ['ben', 'amy', 'lee'],
  };
  assert.equal(groupChangeCount(saved), 0);
  assert.equal(
    groupChangeCount({ ...saved, draftMemberIds: ['amy', 'lee'] }),
    1
  );
  assert.equal(
    groupChangeCount({ ...saved, draftMemberIds: ['amy', 'ben', 'chris'] }),
    2
  );
  assert.equal(groupChangeCount({ ...saved, draftName: 'Night shift' }), 1);
  assert.equal(
    groupChangeCount({ ...saved, draftName: '  Night shift  ', draftMemberIds: ['amy', 'ben', 'chris'] }),
    3
  );
  assert.equal(saveChangesLabel(2), 'Save changes (2)');
  assert.equal(saveChangesLabel(0), 'Save changes (0)');

  const screen = readFileSync(new URL('../app/(app)/groups/[groupId].tsx', import.meta.url), 'utf8');
  const assignees = readFileSync(new URL('../app/(app)/sites/[siteId]/assignments.tsx', import.meta.url), 'utf8');
  assert.match(screen, /accessibilityState=\{\{ selected: on, checked: on \}\}/);
  assert.match(screen, /minHeight: 48/);
  assert.match(screen, /usePreventRemove\(unsaved && !allowLeave/);
  assert.match(screen, /Save changes to \{promptName\}\?/);
  assert.match(screen, /label="Keep editing"/);
  assert.match(screen, /label="Discard"/);
  assert.match(screen, /saveChangesLabel\(changeCount\)/);
  assert.match(screen, /footer=\{editor \? saveBar : null\}/);
  assert.match(screen, /NoLoginBadge/);
  assert.match(assignees, /NoLoginBadge/);
  assert.match(assignees, /Takes off people this gang put on the site\. People you added by hand stay\./);
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
  assert.equal(removed.removed, 2);
  const oak = await fixtureRepo.listAssignments(IDS.oak);
  assert.equal(oak.some((row) => row.person_id === IDS.amy), true);
  assert.equal(oak.some((row) => row.person_id === IDS.ben), true);
  assert.equal(oak.some((row) => row.person_id === IDS.cm), true);
  assert.equal(oak.some((row) => row.person_id === IDS.lee), false);
  assert.equal(oak.some((row) => row.person_id === IDS.chris), false);
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

test('a gang remove leaves manual rows, the other gang, and the caller', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const first = await fixtureRepo.createPeopleGroup('First gang');
  const second = await fixtureRepo.createPeopleGroup('Second gang');
  await fixtureRepo.setPeopleGroupMembers(first, [IDS.amy, IDS.lee]);
  await fixtureRepo.setPeopleGroupMembers(second, [IDS.lee]);
  assert.equal((await fixtureRepo.assignGroupToSites(first, [IDS.oak])).added, 1);
  assert.equal((await fixtureRepo.assignGroupToSites(second, [IDS.oak])).added, 0);
  assert.equal((await fixtureRepo.removeGroupFromSite(first, IDS.oak)).removed, 0);
  const afterFirst = await fixtureRepo.listAssignments(IDS.oak);
  assert.equal(afterFirst.some((row) => row.person_id === IDS.lee), true);
  assert.equal(afterFirst.some((row) => row.person_id === IDS.amy), true);
  assert.equal((await fixtureRepo.removeGroupFromSite(second, IDS.oak)).removed, 1);
  const afterSecond = await fixtureRepo.listAssignments(IDS.oak);
  assert.equal(afterSecond.some((row) => row.person_id === IDS.lee), false);
  assert.equal(afterSecond.some((row) => row.person_id === IDS.amy), true);

  const kept = await fixtureRepo.createPeopleGroup('Kept gang');
  await fixtureRepo.setPeopleGroupMembers(kept, [IDS.chris]);
  assert.equal((await fixtureRepo.assignGroupToSites(kept, [IDS.riverside])).added, 1);
  await fixtureRepo.deletePeopleGroup(kept);
  const riverside = await fixtureRepo.listAssignments(IDS.riverside);
  assert.equal(riverside.some((row) => row.person_id === IDS.chris), true);

  const yard = await fixtureRepo.createSite({ name: 'CM yard' });
  const leaders = await fixtureRepo.createPeopleGroup('Leaders');
  await fixtureRepo.setPeopleGroupMembers(leaders, [IDS.owner, IDS.cm, IDS.lee]);
  await fixtureRepo.assignGroupToSites(leaders, [yard.id]);
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  const removed = await fixtureRepo.removeGroupFromSite(leaders, yard.id);
  assert.equal(removed.removed, 1);
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const yardRows = await fixtureRepo.listAssignments(yard.id);
  assert.equal(yardRows.some((row) => row.person_id === IDS.lee), false);
  assert.equal(yardRows.some((row) => row.person_id === IDS.owner), true);
  assert.equal(yardRows.some((row) => row.person_id === IDS.cm), true);
});
