import assert from 'node:assert/strict';
import test from 'node:test';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { londonWeekStart } from '../lib/attendanceHours.ts';

test('an operative sees only their own hours and cannot correct them', async () => {
  resetFixtureStore();
  const device = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const amyIn = await fixtureRepo.signInSite(IDS.oak, device);
  assert.equal(amyIn.in_gap, false);
  assert.equal(amyIn.in_at, amyIn.in_received_at);
  assert.notEqual(amyIn.in_device_at, amyIn.in_at);
  await fixtureRepo.signOutSite(IDS.oak, new Date().toISOString());
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('ben@sitepack.test', SEED_PASSWORD);
  const benIn = await fixtureRepo.signInSite(IDS.oak, new Date().toISOString());
  await fixtureRepo.signOutSite(IDS.oak, new Date().toISOString());
  const benHistory = await fixtureRepo.listMyAttendance(IDS.oak);
  assert.equal(benHistory.length, 1);
  assert.equal(benHistory[0]?.person_id, IDS.ben);
  assert.equal(await fixtureRepo.attendanceEntry(amyIn.entry_id), null);
  assert.equal(await fixtureRepo.listOnSiteNow(IDS.oak), null);
  assert.equal(await fixtureRepo.weeklyAttendance(IDS.oak, londonWeekStart(new Date().toISOString())), null);
  await assert.rejects(
    () => fixtureRepo.correctAttendance(benIn.entry_id, new Date().toISOString(), new Date().toISOString(), 'No'),
    /not_authorized/
  );
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const amyHistory = await fixtureRepo.listMyAttendance(IDS.oak);
  assert.equal(amyHistory.length, 1);
  assert.equal(amyHistory[0]?.entry_id, amyIn.entry_id);
  await assert.rejects(() => fixtureRepo.listMyAttendance(IDS.warehouse), /not_authorized/);
});

test('a correction keeps the before and after and an operative does not receive the log', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const created = await fixtureRepo.signInSite(IDS.oak, new Date(Date.now() - 11 * 60 * 1000).toISOString());
  assert.equal(created.in_gap, true);
  assert.equal(created.in_at, created.in_received_at);
  const closed = await fixtureRepo.signOutSite(IDS.oak, new Date().toISOString());
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const inAt = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const outAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await assert.rejects(() => fixtureRepo.correctAttendance(closed.entry_id, inAt, outAt, '   '), /invalid_input/);
  const corrected = await fixtureRepo.correctAttendance(closed.entry_id, inAt, outAt, 'Left at four, not when the phone synced');
  const audit = corrected.audit?.[0];
  assert.equal(audit?.reason, 'Left at four, not when the phone synced');
  assert.notEqual(audit?.before_entry.in_at, audit?.after_entry.in_at);
  assert.equal(audit?.before_entry.in_device_at, audit?.after_entry.in_device_at);
  assert.equal(audit?.after_entry.in_at, inAt);
  assert.equal(corrected.in_at, inAt);
  const live = await fixtureRepo.listOnSiteNow(IDS.oak);
  assert.ok(live);
  assert.equal(live.rows.length, 0);
  const sheet = await fixtureRepo.weeklyAttendance(IDS.oak, londonWeekStart(new Date().toISOString()));
  assert.equal(sheet?.entries.some((entry) => entry.entry_id === closed.entry_id), true);
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const seen = await fixtureRepo.attendanceEntry(closed.entry_id);
  assert.equal(seen?.in_at, inAt);
  assert.equal(seen?.audit, null);
});
