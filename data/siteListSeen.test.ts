import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  DRAWINGS_LIST_BOTTOM_PAD,
  SITE_BAR,
  SITE_BAR_BADGE_FONT,
  SITE_BAR_BADGE_SIZE,
  SITE_BAR_MIN_HEIGHT,
  SITE_HEADER_HIT,
  countNewSince,
  isMissingSeenTable,
} from './siteListSeen.ts';

test('site bar is Snags, Variations, and Requests', () => {
  assert.equal(SITE_BAR.length, 3);
  assert.deepEqual(
    SITE_BAR.map((item) => item.label),
    ['Snags', 'Variations', 'Requests']
  );
  assert.deepEqual(
    SITE_BAR.map((item) => item.kind),
    ['snags', 'variations', 'requests']
  );
  assert.equal(SITE_BAR.map((item) => `${item.kind}:${item.label}`).join(' ').includes('drawings'), false);
  assert.equal(SITE_BAR.map((item) => item.label).join(' ').includes('Drawings'), false);
  assert.deepEqual(
    SITE_BAR.map((item) => item.icon),
    ['report-problem', 'compare-arrows', 'assignment']
  );
  assert.equal(SITE_BAR_MIN_HEIGHT >= 48, true);
  assert.equal(SITE_HEADER_HIT >= 48, true);
  assert.equal(SITE_BAR_BADGE_SIZE >= 20 && SITE_BAR_BADGE_SIZE <= 22, true);
  assert.equal(SITE_BAR_BADGE_FONT, 12);
  assert.equal(DRAWINGS_LIST_BOTTOM_PAD >= SITE_BAR_MIN_HEIGHT, true);
  assert.deepEqual(
    SITE_BAR.map((item) => item.path('oak')),
    ['/sites/oak/snags', '/sites/oak/variations', '/sites/oak/requests']
  );
});

test('new-since counts only rows after this user last opened the list', () => {
  const rows = ['2026-10-01T00:00:00.000Z', '2026-10-20T00:00:00.000Z', '2026-10-24T12:00:00.000Z'];
  assert.equal(countNewSince(rows, null), 3);
  assert.equal(countNewSince(rows, undefined), 3);
  assert.equal(countNewSince(rows, ''), 3);
  assert.equal(countNewSince(rows, 'not-a-date'), 3);
  assert.equal(countNewSince(rows, '2026-10-20T00:00:00.000Z'), 1);
  assert.equal(countNewSince(rows, '2026-10-24T12:00:00.000Z'), 0);
  assert.equal(countNewSince(['nope', '2026-10-24T12:00:00.000Z'], '2026-10-01T00:00:00.000Z'), 1);
  assert.equal(countNewSince([], null), 0);
});

test('a missing seen table is the signal to hide the badge', () => {
  assert.equal(isMissingSeenTable({ code: '42P01', message: 'relation does not exist' }), true);
  assert.equal(isMissingSeenTable({ code: 'PGRST205', message: 'schema cache' }), true);
  assert.equal(isMissingSeenTable({ message: 'Could not find the table public.site_list_seen' }), true);
  assert.equal(isMissingSeenTable({ code: '42501', message: 'permission denied' }), false);
  assert.equal(isMissingSeenTable(null), false);
});

test('site page is drawings, a People button, and a three-item bar', () => {
  const site = fs.readFileSync('app/(app)/sites/[siteId]/index.tsx', 'utf8');
  const bar = fs.readFileSync('components/site-bar.tsx', 'utf8');
  const people = fs.readFileSync('app/(app)/sites/[siteId]/people.tsx', 'utf8');
  const migration = fs.readFileSync('supabase/migrations/20261024080000_site_list_seen.sql', 'utf8');

  assert.match(site, /<SiteBar /);
  assert.match(site, /siteName=\{site\.name\}/);
  assert.match(site, /contentPaddingBottom=\{DRAWINGS_LIST_BOTTOM_PAD\}/);
  assert.match(site, /headerBackVisible: false/);
  assert.match(site, /<SitesBackButton \/>/);
  assert.match(site, /<PeoplePill /);
  assert.equal(site.includes('label="People"'), false);
  assert.equal(site.includes('Invite to this site'), false);
  assert.equal(site.includes('Who joined'), false);
  assert.equal(site.includes('label="Snags"'), false);
  assert.equal(site.includes('label="Variations"'), false);
  assert.equal(site.includes('Request a drawing'), false);
  assert.equal(site.includes('label="Request drawing"'), false);

  assert.match(bar, /SITE_BAR\.map/);
  assert.match(bar, /useSafeAreaInsets/);
  assert.match(bar, /minHeight: SITE_BAR_MIN_HEIGHT/);
  assert.match(bar, /paddingBottom: Math\.max\(insets\.bottom, 8\)/);
  assert.match(bar, /On this site/);
  assert.match(bar, /name=\{item\.icon\}/);
  assert.match(bar, /color: theme\.text/);
  assert.match(bar, /SITE_BAR_BADGE_SIZE/);
  assert.match(bar, /fontSize: SITE_BAR_BADGE_FONT/);
  assert.equal(bar.includes('Drawings'), false);
  assert.equal(bar.includes('color: theme.muted, fontWeight: \'800\' }>{item.label}'), false);
  const header = fs.readFileSync('components/site-header.tsx', 'utf8');
  assert.match(header, /← Sites/);
  assert.match(header, /minWidth: SITE_HEADER_HIT/);
  assert.match(header, /minHeight: SITE_HEADER_HIT/);
  assert.match(header, />People</);
  assert.match(header, /borderRadius: 999/);

  assert.match(people, /canManageSite/);
  assert.match(people, /Invite to this site/);
  assert.match(people, /listAssignments/);
  assert.doesNotMatch(people.slice(0, people.indexOf('const manage')), /Invite to this site/);

  assert.match(migration, /enable row level security/);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
  const insertPolicy = migration.slice(
    migration.indexOf('create policy site_list_seen_insert'),
    migration.indexOf('create policy site_list_seen_update')
  );
  const updatePolicy = migration.slice(
    migration.indexOf('create policy site_list_seen_update'),
    migration.indexOf('-- People on a site')
  );
  assert.match(insertPolicy, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(insertPolicy, /private\.can_access_site\(site_id\)/);
  assert.match(updatePolicy, /using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.equal(updatePolicy.slice(0, updatePolicy.indexOf('with check')).includes('can_access_site'), false);
  assert.match(updatePolicy.slice(updatePolicy.indexOf('with check')), /user_id = \(select auth\.uid\(\)\)/);
  assert.match(updatePolicy.slice(updatePolicy.indexOf('with check')), /private\.can_access_site\(site_id\)/);
  assert.match(migration, /grant select, insert, update on table public\.site_list_seen to authenticated/);
  assert.equal(migration.includes('for delete'), false);
  assert.equal(migration.includes('grant delete'), false);
  assert.match(migration, /kind in \('snags', 'variations', 'requests'\)/);
  assert.match(migration, /primary key \(user_id, site_id, kind\)/);
  assert.match(migration, /site_assignments_select/);
  assert.match(migration, /using \(private\.can_access_site\(site_id\)\)/);
});
