import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import {
  buildRoster,
  buildSiteSummary,
  confirmSeen,
  newDrawingsLine,
  newRevLabel,
  notSeenPersonLine,
  notSeenYetHeading,
  recordOpen,
  resolveSeenAt,
  seenButtonLabel,
  seenCountLabel,
  cardCountLine,
  siteUnseenLine,
  type ProofOpen,
  type ProofSeen,
  type SeenSheet,
} from './drawingSeen.ts';

const sheet = (id: string, revision: string, current: boolean): SeenSheet => ({
  id,
  site_id: 'site',
  title: 'Ground Floor GA',
  sheet_number: 'A-101',
  revision,
  is_current: current,
});

test('a tap time is kept when it is after the open and within five minutes', () => {
  const openedAt = '2026-10-22T09:00:00.000Z';
  const receivedAt = '2026-10-22T12:00:00.000Z';
  const tap = '2026-10-22T09:06:00.000Z';
  assert.equal(resolveSeenAt(tap, openedAt, receivedAt), tap);
  assert.equal(resolveSeenAt('2026-10-22T12:05:00.000Z', openedAt, receivedAt), '2026-10-22T12:05:00.000Z');
  assert.equal(resolveSeenAt('2026-10-22T12:06:00.000Z', openedAt, receivedAt), receivedAt);
  assert.equal(resolveSeenAt('2026-10-22T08:59:00.000Z', openedAt, receivedAt), receivedAt);
  assert.equal(resolveSeenAt(null, openedAt, receivedAt), receivedAt);

  const opens: ProofOpen[] = [];
  const seen: ProofSeen[] = [];
  recordOpen(opens, { drawing_id: 'b', site_id: 'site', person_id: 'amy', revision: 'B', opened_at: openedAt });
  const kept = confirmSeen(opens, seen, {
    drawing_id: 'b',
    site_id: 'site',
    person_id: 'amy',
    revision: 'B',
    seen_at: tap,
    received_at: receivedAt,
  });
  assert.equal(kept.seen_at, tap);
  assert.equal(kept.received_at, receivedAt);
  const again = confirmSeen(opens, seen, {
    drawing_id: 'b',
    site_id: 'site',
    person_id: 'amy',
    revision: 'B',
    seen_at: '2026-10-22T12:06:00.000Z',
    received_at: '2026-10-22T13:00:00.000Z',
  });
  assert.equal(again.seen_at, tap);
});

test('labels name the sheet and the revision', () => {
  assert.equal(newRevLabel('A-101', 'C'), 'New: A-101 rev C');
  assert.equal(seenCountLabel(7, 9), '7 of 9 seen');
  assert.equal(seenButtonLabel('C'), "I've seen rev C");
  assert.equal(siteUnseenLine(0), null);
  assert.equal(siteUnseenLine(1), '1 drawing not seen by everyone');
  assert.equal(siteUnseenLine(2), '2 drawings not seen by everyone');
  assert.equal(cardCountLine(0, 0), null);
  assert.equal(cardCountLine(1, 0), '1 request');
  assert.equal(cardCountLine(2, 0), '2 requests');
  assert.equal(cardCountLine(0, 1), '1 unseen');
  assert.equal(cardCountLine(1, 6), '1 request · 6 unseen');
  assert.equal(cardCountLine(3, 1), '3 requests · 1 unseen');
  assert.equal(newDrawingsLine(0), null);
  assert.equal(newDrawingsLine(1), '1 new drawing to check');
  assert.equal(newDrawingsLine(5), '5 new drawings to check');
  assert.equal(notSeenYetHeading(2), 'Not seen yet (2)');
  assert.equal(notSeenPersonLine('Ben Torres', 6), 'Ben Torres: 6 sheets');
  assert.equal(notSeenPersonLine('Ben Torres', 1), 'Ben Torres: 1 sheet');
});

test('replacing a revision resets the count and a removed person drops out of N', () => {
  const opens: ProofOpen[] = [];
  const seen: ProofSeen[] = [];
  const revB = sheet('b', 'B', true);
  const people = [
    { site_id: 'site', person_id: 'amy', role: 'operative' as const },
    { site_id: 'site', person_id: 'ben', role: 'operative' as const },
    { site_id: 'site', person_id: 'priya', role: 'cm' as const },
  ];
  const names = [
    { id: 'amy', display_name: 'Amy Keane' },
    { id: 'ben', display_name: 'Ben Torres' },
    { id: 'priya', display_name: 'Priya Shah' },
  ];
  assert.throws(() => confirmSeen(opens, seen, { drawing_id: 'b', site_id: 'site', person_id: 'amy', revision: 'B' }), /not_opened/);
  recordOpen(opens, { drawing_id: 'b', site_id: 'site', person_id: 'amy', revision: 'B', opened_at: '2026-10-22T09:00:00.000Z' });
  recordOpen(opens, { drawing_id: 'b', site_id: 'site', person_id: 'ben', revision: 'B', opened_at: '2026-10-22T09:05:00.000Z' });
  confirmSeen(opens, seen, { drawing_id: 'b', site_id: 'site', person_id: 'amy', revision: 'B', seen_at: '2026-10-22T09:06:00.000Z' });
  confirmSeen(opens, seen, { drawing_id: 'b', site_id: 'site', person_id: 'ben', revision: 'B', seen_at: '2026-10-22T09:07:00.000Z' });
  const summary = buildSiteSummary('site', [revB], people, seen);
  assert.equal(summary.drawings[0]?.seen_count, 2);
  assert.equal(summary.assigned_count, 2);
  const withManager = buildRoster(revB, people, names, seen);
  assert.equal(withManager.unseen.some((person) => person.person_id === 'priya'), false);
  assert.equal(withManager.seen.some((person) => person.person_id === 'priya'), false);
  assert.equal(notSeenYetHeading(withManager.unseen.length), 'Not seen yet (0)');

  const stillAssigned = people.filter((row) => row.person_id !== 'ben');
  const afterRemoval = buildRoster({ ...revB, is_current: false }, stillAssigned, names, seen);
  assert.equal(afterRemoval.assigned_count, 1);
  assert.equal(afterRemoval.seen_count, 1);
  assert.equal(afterRemoval.seen[0]?.person_id, 'amy');
  assert.equal(seen.filter((row) => row.person_id === 'ben').length, 1);

  const revC = sheet('c', 'C', true);
  const replaced = buildSiteSummary('site', [{ ...revB, is_current: false }, revC], stillAssigned, seen);
  assert.equal(replaced.drawings.length, 1);
  assert.equal(replaced.drawings[0]?.drawing_id, 'c');
  assert.equal(replaced.drawings[0]?.seen_count, 0);
  assert.equal(replaced.assigned_count, 1);
  assert.equal(replaced.not_seen_by_everyone, 1);
  assert.throws(
    () => confirmSeen(opens, seen, { drawing_id: 'c', site_id: 'site', person_id: 'amy', revision: 'C' }),
    /not_opened/
  );
});

test('a lad confirmation shows for the owner, and another site stays hidden', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.confirmDrawingSeen(IDS.gfRevC), /not_opened/);
  await assert.rejects(() => fixtureRepo.recordDrawingOpen(IDS.yard), /drawing_not_found/);
  await assert.rejects(() => fixtureRepo.confirmDrawingSeen(IDS.yard), /drawing_not_found/);
  await fixtureRepo.recordDrawingOpen(IDS.gfRevC);
  const tap = new Date().toISOString();
  const seen = await fixtureRepo.confirmDrawingSeen(IDS.gfRevC, tap);
  assert.equal(seen.seenAt, tap);
  const amyUnseen = await fixtureRepo.listMyUnseenDrawings();
  assert.equal(
    amyUnseen.some((row) => row.drawing_id === IDS.gfRevC),
    false
  );
  assert.equal(amyUnseen.find((row) => row.drawing_id === IDS.ffRevA)?.sheet, 'A-102');
  assert.equal(newRevLabel('A-102', 'A'), 'New: A-102 rev A');

  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const roster = await fixtureRepo.drawingSeenRoster(IDS.gfRevC);
  assert.equal(roster.seen_count, 1);
  assert.equal(roster.assigned_count, 2);
  assert.equal(roster.unseen.some((person) => person.person_id === IDS.cm), false);
  assert.equal(roster.seen.some((person) => person.display_name === 'Priya Shah'), false);
  const notSeen = await fixtureRepo.siteNotSeen(IDS.oak);
  assert.equal(notSeen.some((person) => person.person_id === IDS.cm), false);
  assert.equal(notSeen.find((person) => person.display_name === 'Ben Torres')?.sheets.length, 7);
  assert.equal(
    notSeenPersonLine('Ben Torres', notSeen.find((person) => person.display_name === 'Ben Torres')?.sheets.length ?? 0),
    'Ben Torres: 7 sheets'
  );
  assert.equal(roster.seen[0]?.display_name, 'Amy Keane');
  assert.equal(roster.seen[0]?.seen_at, tap);
  assert.equal(
    roster.unseen.some((person) => person.person_id === IDS.amy),
    false
  );
  const summary = await fixtureRepo.siteDrawingSeen(IDS.oak);
  assert.equal(summary.drawings.find((row) => row.drawing_id === IDS.gfRevC)?.seen_count, 1);
  assert.ok(summary.not_seen_by_everyone >= 1);

  await fixtureRepo.removeAssignment('aaaaaaaa-0001-0000-0000-000000000002');
  const after = await fixtureRepo.drawingSeenRoster(IDS.gfRevC);
  assert.equal(after.assigned_count, 1);
  assert.equal(after.seen_count, 0);
  assert.equal(after.seen.some((person) => person.person_id === IDS.amy), false);

  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  const replaced = await fixtureRepo.replaceDrawing({
    siteId: IDS.oak,
    title: 'Ground Floor GA',
    sheetNumber: 'A-101',
    revision: 'D',
    storagePath: 'memory/d.pdf',
    replaceDrawingId: IDS.gfRevC,
  });
  const reset = await fixtureRepo.siteDrawingSeen(IDS.oak);
  assert.equal(reset.drawings.find((row) => row.drawing_id === replaced.id)?.seen_count, 0);
  assert.equal(reset.drawings.some((row) => row.drawing_id === IDS.gfRevC), false);
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.confirmDrawingSeen(replaced.id), /drawing_not_found/);
});

test('the drawing seen migration does not touch storage or earlier files', () => {
  const names = fs
    .readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort();
  assert.ok(names.includes('20261022160000_drawing_seen.sql'));
  assert.ok(names.indexOf('20261022160000_drawing_seen.sql') > names.indexOf('20261022150000_variations.sql'));
  const sql = fs.readFileSync('supabase/migrations/20261022160000_drawing_seen.sql', 'utf8');
  assert.match(sql, /create policy drawing_seen_select/);
  assert.match(sql, /create policy drawing_revision_opens_select/);
  assert.match(sql, /not_opened/);
  assert.match(sql, /received_at timestamptz not null/);
  assert.match(sql, /interval '5 minutes'/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /private\.can_access_site/);
  assert.doesNotMatch(sql, /storage\.objects/);
  assert.doesNotMatch(sql, /grant .*schema storage/i);
  assert.doesNotMatch(sql, /schema auth/i);
  assert.doesNotMatch(sql, /service_role/);
  const probe = fs.readFileSync('scripts/drawing-seen-rls.sql', 'utf8');
  assert.match(probe, /cannot confirm a revision that has not been opened/);
  assert.match(probe, /device tap time is stored as seen_at/);
  assert.match(probe, /more than 5 minutes in the future/);
  assert.match(probe, /before the recorded open/);
  assert.match(probe, /who-list shows the device tap time/);
  assert.match(probe, /replacing rev B with C resets the count/);
  assert.match(probe, /removed people drop out of N/);
  assert.match(probe, /firm Y cannot read firm X/);
  assert.match(probe, /operative of site B cannot read site A/);
  assert.match(probe, /an outsider gets drawing_not_found for a drawing that exists/);
  assert.match(probe, /anon cannot call drawing seen functions/);
  assert.match(probe, /the count is operatives only and a contracts manager does not count/);
  assert.match(probe, /not seen yet lists operatives only/);
  assert.match(sql, /revoke all on function public\.confirm_drawing_seen\(uuid, timestamptz\) from public, anon;/);
  assert.match(sql, /revoke all on function public\.site_not_seen\(uuid\) from public, anon;/);
  assert.match(sql, /p\.role = 'operative'/);
  const stub = fs.readFileSync('scripts/throwaway-auth.sql', 'utf8');
  assert.match(stub, /grant all on functions to anon, authenticated, service_role/);
  const who = fs.readFileSync('app/(app)/sites/[siteId]/seen/[drawingId].tsx', 'utf8');
  assert.ok(who.indexOf('notSeenYetHeading') < who.indexOf('roster.seen.map'));
  const home = fs.readFileSync('app/(app)/sites/index.tsx', 'utf8');
  assert.match(home, /newDrawingsLine/);
  assert.doesNotMatch(home, /NewRevBadge/);
  assert.match(home, /GlanceRow/);
  const offline = fs.readFileSync('lib/variationQueue.ts', 'utf8');
  assert.match(offline, /__DEV__ && process\.env\.EXPO_PUBLIC_USE_FIXTURES === '1'/);
  assert.match(offline, /sitepack\.dev\.forceOffline/);
  const bundleCheck = fs.readFileSync('scripts/check-prod-bundle.mjs', 'utf8');
  assert.match(bundleCheck, /sitepack\.dev\.forceOffline/);
  assert.match(
    sql,
    /function public\.record_drawing_open[\s\S]*?if not found or not private\.can_access_site\(v_drawing\.site_id\) then\s+raise exception 'drawing_not_found'[\s\S]*?function public\.confirm_drawing_seen/
  );
  assert.match(
    sql,
    /function public\.confirm_drawing_seen[\s\S]*if not found or not private\.can_access_site\(v_drawing\.site_id\) then\s+raise exception 'drawing_not_found'/
  );
  const runner = fs.readFileSync('scripts/run-drawing-seen-rls.sh', 'utf8');
  assert.match(runner, /supabase\.co/);
  assert.match(runner, /alter table storage\.objects enable row level security/);
});
