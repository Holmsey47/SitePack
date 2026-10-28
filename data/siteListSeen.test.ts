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
  SITE_HEADER_INSET,
  badgeReadIsCurrent,
  countNewSince,
  countUnseen,
  isMissingSeenTable,
  saveSeenWithRetry,
} from './siteListSeen.ts';
import { sitePeopleOwnerName, visibleSiteOwner } from './walk.ts';

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
  assert.equal(SITE_HEADER_INSET, 8);
  assert.equal(SITE_BAR_BADGE_SIZE >= 20 && SITE_BAR_BADGE_SIZE <= 22, true);
  assert.equal(SITE_BAR_BADGE_FONT, 15);
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

test('own rows stay off the badge, and a missing self still counts everyone', () => {
  const rows = [
    { at: '2026-10-24T12:00:00.000Z', by: 'me' },
    { at: '2026-10-24T13:00:00.000Z', by: 'them' },
    { at: '2026-10-01T00:00:00.000Z', by: 'them' },
  ];
  assert.equal(countUnseen(rows, null, 'me'), 2);
  assert.equal(countUnseen(rows, '2026-10-20T00:00:00.000Z', 'me'), 1);
  assert.equal(countUnseen(rows, '2026-10-24T13:00:00.000Z', 'me'), 0);
  assert.equal(countUnseen(rows, null, null), 3);
  assert.equal(countUnseen(rows, null, ''), 3);
  assert.equal(countUnseen([{ at: '2026-10-24T12:00:00.000Z', by: null }], null, 'me'), 1);
});

test('a seen save is tried twice, and a success is not repeated', async () => {
  let failed = 0;
  const recovered = await saveSeenWithRetry(async () => {
    failed += 1;
    return failed > 1;
  });
  assert.equal(recovered, true);
  assert.equal(failed, 2);

  let thrown = 0;
  const gaveUp = await saveSeenWithRetry(async () => {
    thrown += 1;
    throw new Error('offline');
  });
  assert.equal(gaveUp, false);
  assert.equal(thrown, 2);

  let once = 0;
  assert.equal(
    await saveSeenWithRetry(async () => {
      once += 1;
      return true;
    }),
    true,
  );
  assert.equal(once, 1);
});

test('a newer badge read wins over one that started earlier', () => {
  assert.equal(badgeReadIsCurrent(2, 2), true);
  assert.equal(badgeReadIsCurrent(1, 2), false);
});

test('the site owner is shown only from a row this caller can already see', () => {
  const owner = { id: 'owner', role: 'owner' as const, display_name: 'Jordan Hale' };
  const cm = { id: 'cm', role: 'cm' as const, display_name: 'Pat' };
  assert.deepEqual(visibleSiteOwner(owner, []), { id: 'owner', name: 'Jordan Hale' });
  assert.equal(visibleSiteOwner(cm, []), null);
  assert.equal(visibleSiteOwner({ id: 'op', role: 'operative', display_name: 'Sam' }, []), null);
  assert.deepEqual(
    visibleSiteOwner(cm, [{ person_id: 'owner', person: { role: 'owner', display_name: 'Jordan Hale' } }]),
    { id: 'owner', name: 'Jordan Hale' },
  );
  const blank = visibleSiteOwner(owner, [{ person_id: 'owner', person: { role: 'owner', display_name: '' } }]);
  assert.equal(blank?.name, 'Unknown');
  assert.equal(
    sitePeopleOwnerName({ display_name: 'Jordan Hale', role: 'owner' }, cm, []),
    'Jordan Hale',
  );
  assert.equal(sitePeopleOwnerName(null, cm, []), null);
  assert.equal(
    sitePeopleOwnerName({ display_name: '   ', role: 'owner' }, { id: 'op', role: 'operative', display_name: 'Sam' }, []),
    'Unknown',
  );
  assert.equal(sitePeopleOwnerName({ display_name: 'Pat', role: 'cm' }, cm, []), null);
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
  assert.match(site, /headerTitle: \(\) => null/);
  assert.match(site, /numberOfLines=\{2\}/);
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
  assert.match(header, /dismissTo\('\/sites'\)/);
  assert.equal(header.includes("navigate('/sites')"), false);
  assert.match(header, /minWidth: SITE_HEADER_HIT/);
  assert.match(header, /minHeight: SITE_HEADER_HIT/);
  assert.match(header, /marginLeft: SITE_HEADER_INSET/);
  assert.match(header, /marginRight: SITE_HEADER_INSET/);
  assert.match(header, />People</);
  assert.match(header, /borderRadius: 999/);

  const layout = fs.readFileSync('app/(app)/_layout.tsx', 'utf8');
  const sitesScreen = layout.slice(layout.indexOf('name="sites/index"'), layout.indexOf('name="sites/[siteId]/index"'));
  assert.match(sitesScreen, /headerBackVisible: false/);
  assert.match(sitesScreen, /headerLeft: \(\) => null/);

  assert.match(site, /onOpen=\{openList\}/);
  assert.match(site, /pendingSiteListSaves/);
  assert.match(site, /badgeReadIsCurrent/);
  assert.match(site, /\[kind\]: 0/);

  const sync = fs.readFileSync('lib/siteListSeenSync.ts', 'utf8');
  assert.equal(sync.includes('toISOString'), false);
  assert.equal(sync.includes('seen_at:'), false);
  assert.match(sync, /saveSeenWithRetry/);
  assert.match(sync, /pendingSaves/);
  assert.match(sync, /raised_by/);
  assert.match(sync, /created_by/);
  assert.match(sync, /requester_id/);
  assert.match(sync, /countUnseen/);

  const requests = fs.readFileSync('app/(app)/sites/[siteId]/requests.tsx', 'utf8');
  assert.equal(requests.indexOf('markSiteListSeen') < requests.indexOf('listSiteRequests'), true);

  const stamp = fs.readFileSync('supabase/migrations/20261026120000_site_list_seen_server_time.sql', 'utf8');
  assert.match(stamp, /new\.seen_at := now\(\)/);
  assert.match(stamp, /before insert or update/);
  assert.match(stamp, /grant execute on function private\.stamp_site_list_seen\(\) to authenticated/);
  assert.equal(stamp.includes('create policy'), false);
  assert.equal(stamp.includes('people_select'), false);

  assert.match(people, /canManageSite/);
  assert.match(people, /Invite to this site/);
  assert.match(people, /listAssignments/);
  assert.match(people, /companyOwnerLabel/);
  assert.match(people, /sitePeopleOwnerName/);
  assert.match(people, /visibleSiteOwner/);
  assert.match(people, />Owner</);
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
