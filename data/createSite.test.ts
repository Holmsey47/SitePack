import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCreateSite } from './createSite.ts';
import { sitesAfterReload } from './siteList.ts';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { SEED_PASSWORD } from './ids.ts';

test('optional lines collapse to null and what it is stays one line', () => {
  const row = normalizeCreateSite({
    name: '  Elm Yard  ',
    mainContractor: '  ',
    addressLine: '\n',
    whatItIs: ' 12 houses \n extra ',
  });
  assert.deepEqual(row, {
    name: 'Elm Yard',
    main_contractor: null,
    address_line: null,
    what_it_is: '12 houses extra',
  });
});

test('a failed site reload keeps the list already on screen', () => {
  const current = [{ site_id: 'elm', name: 'Elm Yard' }];
  const failed = sitesAfterReload(null, current);
  assert.deepEqual(failed.sites, current);
  assert.equal(failed.notice, 'The site list did not reload.');

  const loaded = sitesAfterReload([{ site_id: 'oak', name: 'Oak' }], current);
  assert.equal(loaded.notice, '');
  assert.equal(loaded.sites[0]?.name, 'Oak');
});

test('a blank name is refused', () => {
  assert.throws(() => normalizeCreateSite({ name: '   ' }), /Name is required/);
});

test('owner create shows on pulse and not on the assigned home', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const before = await fixtureRepo.companySitesPulse();
  const site = await fixtureRepo.createSite({
    name: 'Elm Yard',
    mainContractor: 'Hale Build',
    addressLine: 'Elm Street',
    whatItIs: '12 houses',
  });
  assert.equal(site.name, 'Elm Yard');
  assert.equal(site.main_contractor, 'Hale Build');
  assert.equal(site.address_line, 'Elm Street');
  assert.equal(site.what_it_is, '12 houses');

  const pulse = await fixtureRepo.companySitesPulse();
  assert.equal(pulse.length, before.length + 1);
  const row = pulse.find((item) => item.site_id === site.id);
  assert.equal(row?.name, 'Elm Yard');
  assert.equal(row?.address_line, 'Elm Street');

  const home = await fixtureRepo.listAssignedSites();
  assert.equal(
    home.some((item) => item.id === site.id),
    false
  );
});

test('a contracts manager cannot create a site', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  await assert.rejects(
    () => fixtureRepo.createSite({ name: 'Should fail' }),
    /not_authorized/
  );
});
