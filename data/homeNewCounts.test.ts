import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { contrastRatio } from '../lib/contrast.ts';
import { theme } from '../lib/theme.ts';
import { loadHomeSiteNewCounts } from '../lib/homeNewCounts.ts';
import { cardCountLine } from './drawingSeen.ts';
import {
  HOME_COUNT_CAP,
  countsForSite,
  formatHomeCount,
  freshLineParts,
  glueNewLine,
  homeCardLines,
  homeNewCountLine,
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

function bareRequestNumbers(text: string): string[] {
  return [...text.matchAll(/(?<!open )(\d+\+?) requests?\b/g)].map((match) => match[1] ?? '');
}

test('the new line hides zero kinds, pluralises, and caps at 999+', () => {
  assert.equal(HOME_COUNT_CAP, 999);
  assert.equal(formatHomeCount(0), null);
  assert.equal(formatHomeCount(1000), '999+');
  assert.equal(homeNewCountLine({ snags: 0, variations: 0, requests: 0 }), null);
  assert.equal(homeNewCountLine(null), null);
  assert.equal(homeNewCountLine({ snags: 1, variations: 1, requests: 1 }), 'New: 1 snag · 1 variation · 1 request');
  assert.equal(glueNewLine('New: 1 snag · 1 variation · 1 request'), 'New:\u00a01\u00a0snag · 1\u00a0variation · 1\u00a0request');
  assert.equal(glueNewLine('New: 999+ snags').includes(' '), false);
  const parts = freshLineParts('New: 1 snag · 1 variation · 1 request');
  assert.deepEqual(parts, ['New:\u00a01\u00a0snag', '1\u00a0variation', '1\u00a0request']);
  assert.equal(parts.every((part) => part.includes(' ') === false), true);
  assert.equal(
    homeNewCountLine({ snags: 2, variations: 2, requests: 2 }),
    'New: 2 snags · 2 variations · 2 requests',
  );
  assert.equal(homeNewCountLine({ snags: 1000, variations: 0, requests: 0 }), 'New: 999+ snags');
  assert.equal(homeNewCountLine({ snags: 0, variations: 1000, requests: 4 }), 'New: 999+ variations · 4 requests');
  assert.equal(homeNewCountLine({ snags: 3, variations: 0, requests: 0 }), 'New: 3 snags');
});

test('a failed read hides the new line and keeps the line main shows today', () => {
  const failed = homeCardLines(1, 2, null);
  assert.equal(failed.fresh, null);
  assert.equal(failed.status, cardCountLine(1, 2));
  assert.equal(failed.status, '1 request · 2 unseen');
  assert.equal(homeCardLines(0, 0, null).status, null);
  assert.equal(homeNewCountLine(null), null);
});

test('a card does not show two request numbers', () => {
  const both = homeCardLines(1, 2, { snags: 1, variations: 1, requests: 1 });
  assert.equal(both.status, '1 open request · 2 unseen');
  assert.equal(both.fresh, 'New: 1 snag · 1 variation · 1 request');
  assert.deepEqual(bareRequestNumbers(`${both.status}\n${both.fresh}`), ['1']);

  const many = homeCardLines(4, 0, { snags: 0, variations: 0, requests: 3 });
  assert.equal(many.status, '4 open requests');
  assert.equal(many.fresh, 'New: 3 requests');
  assert.deepEqual(bareRequestNumbers(`${many.status}\n${many.fresh}`), ['3']);

  const noNewRequests = homeCardLines(2, 1, { snags: 5, variations: 0, requests: 0 });
  assert.equal(noNewRequests.status, '2 requests · 1 unseen');
  assert.equal(noNewRequests.fresh, 'New: 5 snags');
  assert.deepEqual(bareRequestNumbers(`${noNewRequests.status}\n${noNewRequests.fresh}`), ['2']);

  const quiet = homeCardLines(1, 7, { snags: 0, variations: 0, requests: 0 });
  assert.equal(quiet.fresh, null);
  assert.equal(quiet.status, '1 request · 7 unseen');
});

test('a failed or unreadable count payload hides every count', () => {
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
  assert.match(home, /homeCardLines\(/);
  assert.match(home, /lines\.fresh/);
  assert.match(home, /freshLineParts/);
  assert.match(home, /testID="site-updated"/);
  assert.match(home, /flexShrink: 0/);
  assert.match(home, /textStyle\.bodyStrong/);
  assert.match(home, /textStyle\.tabular/);
  assert.doesNotMatch(home, /join\(' · '\)/);
  assert.match(home, /minHeight: hit\.min/);
  assert.equal(home.includes('NewCountPills'), false);
  assert.equal(home.includes('homeCountPills'), false);
  assert.equal(home.includes('backgroundColor: theme.danger'), false);
  assert.equal(/#[0-9A-Fa-f]{3,8}/.test(home), false);
  assert.match(sync, /export function allPendingSiteListSaves/);
  assert.ok(contrastRatio(theme.currentInk, theme.danger) >= 4.5);
});
