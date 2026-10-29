import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { contrastRatio } from '../lib/contrast.ts';
import { theme } from '../lib/theme.ts';
import { loadHomeSiteNewCounts } from '../lib/homeNewCounts.ts';
import {
  HOME_COUNT_CAP,
  countsForSite,
  formatHomeCount,
  homeCountPills,
  mapHomeNewCounts,
} from './homeNewCounts.ts';

const sites = ['s1', 's2', 's3', 's4', 's5'].map((siteId, index) => ({
  site_id: siteId,
  snags_new: index,
  variations_new: index + 10,
  requests_new: 0,
}));

test('home counts map one row per site and keep the three kinds', () => {
  const mapped = mapHomeNewCounts(sites);
  assert.ok(mapped);
  assert.deepEqual(Object.keys(mapped), ['s1', 's2', 's3', 's4', 's5']);
  assert.deepEqual(mapped.s1, { snags: 0, variations: 10, requests: 0 });
  assert.deepEqual(mapped.s5, { snags: 4, variations: 14, requests: 0 });
  assert.deepEqual(mapHomeNewCounts([{ site_id: 'oak', snags_new: '2', variations_new: '0', requests_new: '11' }]), {
    oak: { snags: 2, variations: 0, requests: 11 },
  });
  assert.deepEqual(mapHomeNewCounts([]), {});
});

test('a home count caps at 999+ and hides zero', () => {
  assert.equal(HOME_COUNT_CAP, 999);
  assert.equal(formatHomeCount(0), null);
  assert.equal(formatHomeCount(-3), null);
  assert.equal(formatHomeCount(Number.NaN), null);
  assert.equal(formatHomeCount(1), '1');
  assert.equal(formatHomeCount(999), '999');
  assert.equal(formatHomeCount(1000), '999+');
  assert.equal(formatHomeCount(5000), '999+');
  const pills = homeCountPills({ snags: 1000, variations: 0, requests: 2 });
  assert.deepEqual(
    pills.map((pill) => `${pill.kind}:${pill.text}`),
    ['snags:999+', 'requests:2'],
  );
  assert.equal(pills.some((pill) => pill.kind === 'variations'), false);
  assert.deepEqual(homeCountPills({ snags: 0, variations: 0, requests: 0 }), []);
  assert.deepEqual(homeCountPills(null), []);
});

test('a failed or unreadable count payload hides every pill', () => {
  assert.equal(mapHomeNewCounts(null), null);
  assert.equal(mapHomeNewCounts(undefined), null);
  assert.equal(mapHomeNewCounts({ site_id: 'oak' }), null);
  assert.equal(mapHomeNewCounts([{ site_id: 'oak', snags_new: 1, variations_new: null, requests_new: 0 }]), null);
  assert.equal(mapHomeNewCounts([{ site_id: '', snags_new: 1, variations_new: 1, requests_new: 1 }]), null);
  assert.equal(countsForSite(null, 'oak'), null);
  assert.deepEqual(countsForSite({}, 'oak'), { snags: 0, variations: 0, requests: 0 });
  const mapped = mapHomeNewCounts(sites);
  assert.deepEqual(countsForSite(mapped, 'missing'), { snags: 0, variations: 0, requests: 0 });
});

test('home loads every site in one call and hides when that call fails', async () => {
  let calls = 0;
  const loaded = await loadHomeSiteNewCounts(async (name) => {
    calls += 1;
    assert.equal(name, 'home_site_new_counts');
    return { data: sites, error: null };
  });
  assert.equal(calls, 1);
  assert.equal(loaded && Object.keys(loaded).length, 5);

  const failed = await loadHomeSiteNewCounts(async () => ({ data: sites, error: { message: 'offline' } }));
  assert.equal(failed, null);

  const thrown = await loadHomeSiteNewCounts(async () => {
    throw new Error('network');
  });
  assert.equal(thrown, null);

  const broken = await loadHomeSiteNewCounts(async () => ({ data: { nope: true }, error: null }));
  assert.equal(broken, null);
});

test('the home count migration is one invoker function and the screen hides a zero', () => {
  const migration = fs.readFileSync('supabase/migrations/20261029180000_home_site_new_counts.sql', 'utf8');
  const probe = fs.readFileSync('scripts/home-new-counts-rls.sql', 'utf8');
  const runner = fs.readFileSync('scripts/run-home-new-counts-rls.sh', 'utf8');
  const home = fs.readFileSync('app/(app)/sites/index.tsx', 'utf8');
  const sync = fs.readFileSync('lib/siteListSeenSync.ts', 'utf8');

  assert.match(migration, /create or replace function public\.home_site_new_counts\(\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /stable/);
  assert.match(migration, /snags_new integer/);
  assert.match(migration, /variations_new integer/);
  assert.match(migration, /requests_new integer/);
  assert.match(migration, /g\.raised_by is distinct from me\.id/);
  assert.match(migration, /v\.is_current/);
  assert.match(migration, /v\.created_by is distinct from me\.id/);
  assert.match(migration, /r\.requester_id is distinct from me\.id/);
  assert.match(migration, /seen\.seen_at is null or g\.raised_at > seen\.seen_at/);
  assert.match(migration, /revoke all on function public\.home_site_new_counts\(\) from public, anon/);
  assert.match(migration, /grant execute on function public\.home_site_new_counts\(\) to authenticated/);
  assert.equal(migration.includes('create table'), false);
  assert.equal(migration.includes('create policy'), false);
  assert.equal(migration.includes('security definer'), false);

  assert.match(probe, /a lad not assigned to site 2 gets no row/);
  assert.match(probe, /people\.id is not the login/);
  assert.match(runner, /supabase\.co/);
  assert.match(runner, /Refusing to run against a hosted Supabase URL/);

  const refresh = home.slice(home.indexOf('const token = ++countToken.current'));
  assert.match(refresh, /setNewCounts\(null\)[\s\S]*allPendingSiteListSaves[\s\S]*loadHomeSiteNewCounts/);
  assert.match(home, /badgeReadIsCurrent/);
  assert.match(home, /countsForSite\(newCounts/);
  assert.match(home, /minHeight: hit\.min/);
  assert.match(home, /backgroundColor: theme\.danger/);
  assert.match(home, /color: theme\.currentInk/);
  assert.match(home, /textStyle\.tabular/);
  assert.equal(/#[0-9A-Fa-f]{3,8}/.test(home), false);
  assert.match(sync, /export function allPendingSiteListSaves/);
  assert.ok(contrastRatio(theme.currentInk, theme.danger) >= 4.5);
});
