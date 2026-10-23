import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { SnagRequestError } from './snagFailure.ts';
import { attendanceError, hourSpans, shiftCard, signOutThenSignIn } from './attendance.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import {
  buildWeekSheet,
  FLAG_CORRECTED,
  FLAG_LATE,
  londonWallIso,
  londonWeekStart,
  weekCsv,
} from '../lib/attendanceHours.ts';

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

test('a correction then a fresh load shows the new total in the sheet and the CSV', async () => {
  resetFixtureStore();
  process.env.EXPO_PUBLIC_USE_FIXTURES = '1';
  const clock = globalThis as { __SITEPACK_NOW?: string };
  const pin = (iso: string) => {
    clock.__SITEPACK_NOW = iso;
    return iso;
  };
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.signInSite(IDS.oak, pin(londonWallIso('2026-10-20', 7, 0)));
  await fixtureRepo.signOutSite(IDS.oak, pin(londonWallIso('2026-10-20', 23, 59)));
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const week = '2026-10-19';
  const before = await fixtureRepo.weeklyAttendance(IDS.oak, week);
  const beforeRows = buildWeekSheet(hourSpans(before?.entries ?? []), week, '2026-10-22T12:00:00.000Z');
  assert.equal(beforeRows[0]?.total, '16h 59m');
  const entry = before?.entries[0];
  assert.ok(entry);
  await fixtureRepo.correctAttendance(entry.entry_id, londonWallIso('2026-10-20', 7, 0), londonWallIso('2026-10-20', 16, 30), 'Left at half four');
  const after = await fixtureRepo.weeklyAttendance(IDS.oak, week);
  const afterRows = buildWeekSheet(hourSpans(after?.entries ?? []), week, '2026-10-22T12:00:00.000Z');
  assert.equal(afterRows[0]?.total, '9h 30m');
  assert.match(weekCsv(afterRows, 'Plot 12 – Oak Estate', week), /9h 30m,9\.50/);
  const card = shiftCard(after?.entries[0] ?? entry);
  assert.equal(card.correction, 'Corrected by Jordan Hale: was signed out');
  assert.equal(card.reason, 'Left at half four');
  assert.equal(card.flags.includes('Not signed out'), false);
  assert.equal(card.flags.includes('Corrected'), false);
  delete clock.__SITEPACK_NOW;

  const screen = fs.readFileSync('app/(app)/sites/[siteId]/attendance/week.tsx', 'utf8');
  assert.match(screen, /useFocusEffect\(/);
  assert.match(screen, /const fresh = await load\(\)/);
  assert.match(screen, /weekCsv\(fresh\.rows/);
  assert.match(screen, /rows: fresh\.rows/);
  assert.match(screen, /row\.dayLines/);
  assert.match(screen, /row\.totalLine/);
  assert.match(screen, /shiftCard\(entry\)/);
  assert.equal(screen.includes('WEEK_DAYS.map'), false);
  assert.equal(screen.includes('useEffect('), false);
  const entryScreen = fs.readFileSync('app/(app)/sites/[siteId]/attendance/[entryId].tsx', 'utf8');
  assert.match(entryScreen, /card\.correction/);
  assert.match(entryScreen, /card\.reason/);
  const button = fs.readFileSync('components/SiteSignButton.tsx', 'utf8');
  assert.match(button, /forgotYesterday\(/);
  assert.match(button, /markForgotSeen\(/);
  assert.match(button, /signOutThenSignIn\(/);
  assert.match(button, /Sign out of \$\{notice\.openSiteName\} and sign in here/);
});

test('a day shift closes before 06:00 and a late sign-out is not labelled Corrected', async () => {
  resetFixtureStore();
  process.env.EXPO_PUBLIC_USE_FIXTURES = '1';
  const clock = globalThis as { __SITEPACK_NOW?: string };
  const pin = (iso: string) => {
    clock.__SITEPACK_NOW = iso;
    return iso;
  };
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.signInSite(IDS.oak, pin(londonWallIso('2026-10-20', 7, 0)));
  const early = pin(londonWallIso('2026-10-21', 5, 30));
  await assert.rejects(() => fixtureRepo.signOutSite(IDS.oak, early), /not_signed_in/);
  const history = await fixtureRepo.listMyAttendance(IDS.oak);
  const closed = history[0];
  assert.equal(closed?.forgot_sign_out, true);
  assert.equal(closed?.late_sign_out, false);
  assert.equal(closed?.out_at, londonWallIso('2026-10-20', 23, 59));
  const next = await fixtureRepo.signInSite(IDS.oak, early);
  assert.equal(next.state, 'in');
  await fixtureRepo.signOutSite(IDS.oak, early);
  await fixtureRepo.signOut();

  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.signInSite(IDS.oak, pin(londonWallIso('2026-10-20', 22, 0)));
  pin(londonWallIso('2026-10-21', 2, 0));
  assert.equal((await fixtureRepo.mySiteAttendance(IDS.oak)).state, 'in');
  const seven = pin(londonWallIso('2026-10-21', 7, 0));
  const late = await fixtureRepo.signOutSite(IDS.oak, seven);
  assert.equal(late.late_sign_out, true);
  assert.equal(late.out_at, londonWallIso('2026-10-20', 23, 59));
  await assert.rejects(() => fixtureRepo.signOutSite(IDS.oak, seven), /not_signed_in/);
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const sheet = await fixtureRepo.weeklyAttendance(IDS.oak, '2026-10-19');
  const spans = hourSpans(sheet?.entries ?? []);
  const lateSpan = spans.find((span) => span.late);
  assert.ok(lateSpan);
  assert.equal(lateSpan.corrected, false);
  const [row] = buildWeekSheet(spans.filter((span) => span.late), '2026-10-19', seven);
  assert.equal(row?.shifts[0]?.flags.includes(FLAG_LATE), true);
  assert.equal(row?.shifts[0]?.flags.includes(FLAG_CORRECTED), false);
  delete clock.__SITEPACK_NOW;
});

test('a duplicate sign-out does not attach to an earlier night shift', async () => {
  resetFixtureStore();
  const clock = globalThis as { __SITEPACK_NOW?: string };
  const pin = (iso: string) => {
    clock.__SITEPACK_NOW = iso;
    return iso;
  };
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.signInSite(IDS.oak, pin(londonWallIso('2026-10-20', 22, 0)));
  const morning = pin(londonWallIso('2026-10-21', 7, 0));
  await fixtureRepo.signInSite(IDS.oak, morning);
  await fixtureRepo.signOutSite(IDS.oak, pin(londonWallIso('2026-10-21', 8, 0)));
  const duplicate = pin(londonWallIso('2026-10-21', 8, 5));
  await assert.rejects(() => fixtureRepo.signOutSite(IDS.oak, duplicate), /not_signed_in/);
  const history = await fixtureRepo.listMyAttendance(IDS.oak);
  const night = history.find((row) => row.in_at === londonWallIso('2026-10-20', 22, 0));
  const day = history.find((row) => row.in_at === morning);
  assert.equal(night?.forgot_sign_out, true);
  assert.equal(night?.late_sign_out, false);
  assert.equal(day?.out_at, londonWallIso('2026-10-21', 8, 0));
  assert.equal(day?.late_sign_out, false);
  delete clock.__SITEPACK_NOW;
});

test('a correction that overlaps another shift names that shift', async () => {
  resetFixtureStore();
  const clock = globalThis as { __SITEPACK_NOW?: string };
  const pin = (iso: string) => {
    clock.__SITEPACK_NOW = iso;
    return iso;
  };
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const first = await fixtureRepo.signInSite(IDS.oak, pin(londonWallIso('2026-10-21', 7, 0)));
  await fixtureRepo.signOutSite(IDS.oak, pin(londonWallIso('2026-10-21', 8, 0)));
  await fixtureRepo.signInSite(IDS.oak, pin(londonWallIso('2026-10-21', 9, 0)));
  await fixtureRepo.signOutSite(IDS.oak, pin(londonWallIso('2026-10-21', 10, 0)));
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await assert.rejects(
    () =>
      fixtureRepo.correctAttendance(
        first.entry_id,
        londonWallIso('2026-10-21', 7, 0),
        londonWallIso('2026-10-21', 11, 0),
        'Stretched over the next shift'
      ),
    (err: unknown) => {
      assert.ok(err instanceof SnagRequestError);
      assert.equal(err.failure.kind === 'business' ? err.failure.code : '', 'correction_overlaps');
      assert.equal(err.failure.kind === 'business' ? err.failure.detail : '', '2026-10-21 09:00 – 2026-10-21 10:00');
      assert.equal(attendanceError(err), 'That overlaps another shift, 2026-10-21 09:00 – 2026-10-21 10:00.');
      return true;
    }
  );
  const sheet = await fixtureRepo.weeklyAttendance(IDS.oak, '2026-10-19');
  const kept = sheet?.entries.find((row) => row.entry_id === first.entry_id);
  assert.equal(kept?.out_at, londonWallIso('2026-10-21', 8, 0));
  delete clock.__SITEPACK_NOW;
});

test('a shift longer than 24 hours is refused', async () => {
  resetFixtureStore();
  process.env.EXPO_PUBLIC_USE_FIXTURES = '1';
  const clock = globalThis as { __SITEPACK_NOW?: string };
  const start = londonWallIso('2026-10-21', 7, 0);
  const exact = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const over = new Date(new Date(exact).getTime() + 60 * 1000).toISOString();
  clock.__SITEPACK_NOW = start;
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const entry = await fixtureRepo.signInSite(IDS.oak, start);
  await fixtureRepo.signOutSite(IDS.oak, start);
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const kept = await fixtureRepo.correctAttendance(entry.entry_id, start, exact, 'Exactly one day');
  assert.equal(kept.out_at, exact);
  await assert.rejects(
    () => fixtureRepo.correctAttendance(entry.entry_id, start, over, 'One minute over'),
    (err: unknown) => {
      assert.ok(err instanceof SnagRequestError);
      assert.equal(err.failure.kind === 'business' ? err.failure.code : '', 'shift_too_long');
      assert.equal(attendanceError(err), 'That shift is longer than 24 hours.');
      return true;
    }
  );
  const still = await fixtureRepo.weeklyAttendance(IDS.oak, '2026-10-19');
  assert.equal(still?.entries.find((row) => row.entry_id === entry.entry_id)?.out_at, exact);
  await fixtureRepo.signOut();
  const longIn = londonWallIso('2026-10-25', 0, 0);
  const longOver = '2026-10-25T23:59:00.000Z';
  clock.__SITEPACK_NOW = longIn;
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.signInSite(IDS.oak, longIn);
  clock.__SITEPACK_NOW = longOver;
  await assert.rejects(() => fixtureRepo.signOutSite(IDS.oak, longOver), (err: unknown) => {
    assert.ok(err instanceof SnagRequestError);
    assert.equal(err.failure.kind === 'business' ? err.failure.code : '', 'shift_too_long');
    assert.equal(attendanceError(err), 'That shift is longer than 24 hours.');
    return true;
  });
  delete clock.__SITEPACK_NOW;
});

test('already signed in names the site he is still on', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.signInSite(IDS.oak, new Date().toISOString());
  await assert.rejects(() => fixtureRepo.signInSite(IDS.riverside, new Date().toISOString()), (err: unknown) => {
    assert.ok(err instanceof SnagRequestError);
    assert.equal(err.failure.kind, 'business');
    assert.equal(err.failure.kind === 'business' ? err.failure.code : '', 'already_signed_in');
    assert.equal(err.failure.kind === 'business' ? err.failure.detail : '', 'Plot 12 – Oak Estate');
    assert.equal(err.failure.kind === 'business' ? err.failure.hint : '', IDS.oak);
    assert.equal(attendanceError(err), 'You are still signed in at Plot 12 – Oak Estate.');
    return true;
  });
});

test('sign out of the open site and sign in here follows the normal close rules', async () => {
  resetFixtureStore();
  process.env.EXPO_PUBLIC_USE_FIXTURES = '1';
  const clock = globalThis as { __SITEPACK_NOW?: string };
  const pin = (iso: string) => {
    clock.__SITEPACK_NOW = iso;
    return iso;
  };
  const signOut = (siteId: string, at: string) => fixtureRepo.signOutSite(siteId, at);
  const signIn = (siteId: string, at: string) => fixtureRepo.signInSite(siteId, at);

  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const now = pin(londonWallIso('2026-10-21', 9, 0));
  await fixtureRepo.signInSite(IDS.oak, now);
  await signOutThenSignIn(IDS.oak, IDS.riverside, now, signOut, signIn);
  const oak = await fixtureRepo.listMyAttendance(IDS.oak);
  assert.equal(oak[0]?.out_at, now);
  assert.equal(oak[0]?.forgot_sign_out, false);
  assert.equal(oak[0]?.late_sign_out, false);
  assert.equal((await fixtureRepo.mySiteAttendance(IDS.riverside)).state, 'in');
  await fixtureRepo.signOutSite(IDS.riverside, now);
  await fixtureRepo.signOut();

  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.signInSite(IDS.oak, pin(londonWallIso('2026-10-20', 22, 0)));
  const early = pin(londonWallIso('2026-10-21', 5, 30));
  await signOutThenSignIn(IDS.oak, IDS.riverside, early, signOut, signIn);
  const held = (await fixtureRepo.listMyAttendance(IDS.oak))[0];
  assert.equal(held?.out_at, early);
  assert.equal(held?.forgot_sign_out, false);
  assert.equal(held?.late_sign_out, false);
  assert.equal((await fixtureRepo.mySiteAttendance(IDS.riverside)).state, 'in');
  await fixtureRepo.signOut();

  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.signInSite(IDS.oak, pin(londonWallIso('2026-10-20', 22, 0)));
  const seven = pin(londonWallIso('2026-10-21', 7, 0));
  await signOutThenSignIn(IDS.oak, IDS.riverside, seven, signOut, signIn);
  const forgotten = (await fixtureRepo.listMyAttendance(IDS.oak))[0];
  assert.equal(forgotten?.forgot_sign_out, true);
  assert.equal(forgotten?.late_sign_out, true);
  assert.equal(forgotten?.out_at, londonWallIso('2026-10-20', 23, 59));
  assert.equal(forgotten?.late_out_at, seven);
  assert.equal((await fixtureRepo.mySiteAttendance(IDS.riverside)).state, 'in');
  delete clock.__SITEPACK_NOW;
});

test('a correction reason drops control characters and an empty one is refused', async () => {
  resetFixtureStore();
  process.env.EXPO_PUBLIC_USE_FIXTURES = '1';
  const clock = globalThis as { __SITEPACK_NOW?: string };
  const start = londonWallIso('2026-10-21', 8, 0);
  clock.__SITEPACK_NOW = start;
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const created = await fixtureRepo.signInSite(IDS.oak, start);
  await fixtureRepo.signOutSite(IDS.oak, londonWallIso('2026-10-21', 12, 0));
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const kept = await fixtureRepo.correctAttendance(
    created.entry_id,
    start,
    londonWallIso('2026-10-21', 16, 0),
    'Left\nat four'
  );
  assert.equal(kept.audit?.[0]?.reason, 'Leftat four');
  assert.equal(shiftCard(kept).correction, 'Corrected by Jordan Hale: was signed out');
  assert.equal(shiftCard(kept).reason, 'Leftat four');
  const sheet = await fixtureRepo.weeklyAttendance(IDS.oak, '2026-10-19');
  const [row] = buildWeekSheet(hourSpans(sheet?.entries ?? []), '2026-10-19', start);
  assert.equal(row?.total, '8h 00m');
  assert.match(weekCsv(row ? [row] : [], 'Oak', '2026-10-19'), /Jordan Hale,Leftat four/);
  await assert.rejects(
    () => fixtureRepo.correctAttendance(created.entry_id, start, londonWallIso('2026-10-21', 16, 0), '\n'),
    /invalid_input/
  );
  await assert.rejects(
    () => fixtureRepo.correctAttendance(created.entry_id, start, londonWallIso('2026-10-21', 16, 0), '\r\u007f'),
    /invalid_input/
  );
  delete clock.__SITEPACK_NOW;
});
