import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from '../data/fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from '../data/ids.ts';
import type { JoinCodeCreated, JoinCodeRow } from '../data/types.ts';
import { performSignOut } from './signOut.ts';
import {
  JOIN_CODE_CACHE_KEY,
  activeCodeNotice,
  bindJoinCodeCacheOwner,
  clearJoinCodeCache,
  confirmThenRegenerate,
  forgetJoinCode,
  isActiveJoinCode,
  loadJoinCodeScreen,
  parseJoinCodeCache,
  readJoinCodeCache,
  rememberJoinCode,
  viewActiveCode,
  type JoinCodeCachePort,
  type JoinCodePlaintext,
} from './joinCodeCache.ts';

const NOW = Date.parse('2026-10-29T12:00:00.000Z');

function memoryPort(initial: string | null = null): JoinCodeCachePort & { raw: () => string | null } {
  let value = initial;
  return {
    async read() {
      return value;
    },
    async write(next) {
      value = next;
    },
    async remove() {
      value = null;
    },
    raw: () => value,
  };
}

function row(partial: Partial<JoinCodeRow> & Pick<JoinCodeRow, 'id'>): JoinCodeRow {
  return {
    site_id: IDS.oak,
    label: null,
    expires_at: '2026-11-01T18:00:00.000Z',
    max_uses: 10,
    uses: 2,
    revoked_at: null,
    created_at: '2026-10-28T09:00:00.000Z',
    ...partial,
  };
}

test('the cache is keyed by code id and drops a revoked, expired, or full code', async () => {
  const port = memoryPort();
  const live = '11111111-1111-4111-8111-111111111111';
  const dead = '22222222-2222-4222-8222-222222222222';
  await rememberJoinCode(port, live, 'K7QM-4XPR');
  await rememberJoinCode(port, dead, 'M8RN-5YSQ');
  const stored = JSON.parse(port.raw() ?? '{}') as JoinCodePlaintext;
  assert.equal(stored[live], 'K7QM-4XPR');
  assert.equal(stored[dead], 'M8RN-5YSQ');
  assert.equal(port.raw()?.includes('code_hash'), false);

  const kept = await loadJoinCodeScreen({
    now: NOW,
    cache: port,
    list: async () => [
      row({ id: live, uses: 2, max_uses: 10 }),
      row({ id: dead, revoked_at: '2026-10-29T10:00:00.000Z' }),
    ],
  });
  assert.equal(kept.kind, 'cached');
  if (kept.kind === 'cached') {
    assert.equal(kept.code, 'K7QM-4XPR');
    assert.equal(kept.row.uses, 2);
  }
  assert.equal((await readJoinCodeCache(port))[dead], undefined);

  const expiredId = '33333333-3333-4333-8333-333333333333';
  const otherId = '44444444-4444-4444-8444-444444444444';
  await rememberJoinCode(port, expiredId, 'P3TW-6ZVA');
  await rememberJoinCode(port, otherId, 'Q4UX-7AWB');
  const afterExpiry = await loadJoinCodeScreen({
    now: NOW,
    cache: port,
    list: async () => [row({ id: expiredId, expires_at: '2026-10-01T00:00:00.000Z' })],
  });
  assert.equal(afterExpiry.kind, 'empty');
  const after = await readJoinCodeCache(port);
  assert.equal(after[expiredId], undefined);
  assert.equal(after[otherId], 'Q4UX-7AWB');
  assert.equal(after[live], 'K7QM-4XPR');

  const fullId = '55555555-5555-4555-8555-555555555555';
  await rememberJoinCode(port, fullId, 'R5VY-8BXC');
  const full = await loadJoinCodeScreen({
    now: NOW,
    cache: port,
    list: async () => [row({ id: fullId, uses: 10, max_uses: 10 })],
  });
  assert.equal(full.kind, 'empty');
  assert.equal((await readJoinCodeCache(port))[fullId], undefined);
  assert.equal(isActiveJoinCode(row({ id: fullId, uses: 10, max_uses: 10 }), NOW), false);
  assert.equal(isActiveJoinCode(row({ id: live }), NOW), true);
});

test('a code this phone cannot show stays hidden, and a cached code is preferred', () => {
  const older = row({ id: 'older-code', created_at: '2026-10-01T00:00:00.000Z' });
  const newer = row({ id: 'newer-code', created_at: '2026-10-02T00:00:00.000Z' });
  const missing = viewActiveCode([newer], {}, NOW);
  assert.equal(missing.kind, 'elsewhere');
  if (missing.kind === 'elsewhere') assert.equal(missing.row.id, 'newer-code');
  const known = viewActiveCode([newer, older], { 'older-code': 'K7QM-4XPR' }, NOW);
  assert.equal(known.kind, 'cached');
  if (known.kind === 'cached') {
    assert.equal(known.row.id, 'older-code');
    assert.equal(known.code, 'K7QM-4XPR');
  }
  assert.equal(viewActiveCode([], { 'older-code': 'K7QM-4XPR' }, NOW).kind, 'empty');
  assert.equal(
    activeCodeNotice('2026-10-22T17:30:00.000Z', '2026-10-22T12:00:00.000Z'),
    'A code is active on another device until today 6:30pm. Make a new one to share it from here.',
  );
  assert.deepEqual(parseJoinCodeCache('not-json'), {});
  assert.equal(Object.hasOwn(parseJoinCodeCache('{"__proto__":"K7QM-4XPR","ok-id":"K7QM-4XPR"}'), '__proto__'), false);
});

test('opening the list five times does not mint, and the list has no plaintext', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const created = await fixtureRepo.createJoinCode({ siteId: IDS.oak, maxUses: 10, hours: 24 });
  const port = memoryPort();
  await rememberJoinCode(port, created.id, created.code);
  let lists = 0;
  for (let i = 0; i < 5; i += 1) {
    const screen = await loadJoinCodeScreen({
      cache: port,
      list: async () => {
        lists += 1;
        return fixtureRepo.listJoinCodes(IDS.oak);
      },
    });
    assert.equal(screen.kind, 'cached');
    if (screen.kind === 'cached') {
      assert.equal(screen.code, created.code);
      assert.equal(screen.row.expires_at, created.expires_at);
    }
  }
  assert.equal(lists, 5);
  const rows = await fixtureRepo.listJoinCodes(IDS.oak);
  assert.equal(rows.length, 1);
  const listed = JSON.stringify(rows);
  assert.equal(listed.includes(created.code), false);
  assert.equal(listed.includes(created.code.replaceAll('-', '')), false);
  assert.equal(listed.includes('code_hash'), false);

  const source = fs.readFileSync(new URL('./joinCodeCache.ts', import.meta.url), 'utf8');
  const loadFn = source.slice(
    source.indexOf('export async function loadJoinCodeScreen'),
    source.indexOf('export async function regenerateJoinCode'),
  );
  assert.match(loadFn, /input\.list\(\)/);
  assert.doesNotMatch(loadFn, /createJoinCode|input\.issue|revoke/);
  const offer = fs.readFileSync(new URL('../components/JoinCodeOffer.tsx', import.meta.url), 'utf8');
  const focus = offer.slice(offer.indexOf('const load = useCallback'), offer.indexOf('async function onMake'));
  assert.match(focus, /loadJoinCodeScreen/);
  assert.doesNotMatch(focus, /createJoinCode/);
  assert.doesNotMatch(fs.readFileSync(new URL('../app/(app)/invite.tsx', import.meta.url), 'utf8'), /createJoinCode/);
  assert.doesNotMatch(fs.readFileSync(new URL('../app/(app)/people.tsx', import.meta.url), 'utf8'), /createJoinCode/);
  assert.match(offer, /!replacing && held\?\.kind === 'cached'/);
  assert.match(offer, /code=\{visible\.code\}/);
  assert.match(offer, /label="Make a join code"/);
  assert.doesNotMatch(offer.split('\n').find((line) => line.includes('label="Make a join code"')) ?? '', /variant=/);
  assert.match(offer, /label="Regenerate" variant="secondary"/);
  assert.match(offer, /\{OLD_CODE_STOPS\}/);
  assert.match(offer, /label="Cancel" variant="secondary" minHeight=\{48\} onPress=\{\(\) => setConfirming\(false\)\}/);
  assert.doesNotMatch(offer, /console\.(log|debug|info|warn|error)/);
  assert.doesNotMatch(source, /console\.(log|debug|info|warn|error)/);
});

test('regenerate revokes, clears the screen, then issues, and a failed issue leaves no dead code', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const created = await fixtureRepo.createJoinCode({ siteId: IDS.oak, maxUses: 4, hours: 24 });
  const port = memoryPort();
  await rememberJoinCode(port, created.id, created.code);

  const cancelled = await confirmThenRegenerate(false, {
    codeId: created.id,
    revoke: async () => {
      throw new Error('cancel must not revoke');
    },
    forget: async () => {
      throw new Error('cancel must not forget');
    },
    onRevoked: () => {
      throw new Error('cancel must not clear');
    },
    issue: async () => {
      throw new Error('cancel must not issue');
    },
    remember: async () => {
      throw new Error('cancel must not remember');
    },
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal((await readJoinCodeCache(port))[created.id], created.code);
  assert.equal((await fixtureRepo.listJoinCodes(IDS.oak)).filter((row) => isActiveJoinCode(row)).length, 1);

  const revokeOrder: string[] = [];
  let shown: string | null = created.code;
  const revokeFailed = await confirmThenRegenerate(true, {
    codeId: created.id,
    revoke: async () => {
      revokeOrder.push('revoke');
      throw new Error('down');
    },
    forget: async () => {
      revokeOrder.push('forget');
    },
    onRevoked: () => {
      revokeOrder.push('clear');
      shown = null;
    },
    issue: async () => {
      revokeOrder.push('issue');
      throw new Error('issue');
    },
    remember: async () => {
      revokeOrder.push('remember');
    },
  });
  assert.equal(revokeFailed.status, 'revoke_failed');
  assert.deepEqual(revokeOrder, ['revoke']);
  assert.equal(shown, created.code);
  assert.equal((await readJoinCodeCache(port))[created.id], created.code);

  const failOrder: string[] = [];
  const issueFailed = await confirmThenRegenerate(true, {
    codeId: created.id,
    revoke: async (id) => {
      failOrder.push('revoke');
      await fixtureRepo.revokeJoinCode(id);
    },
    forget: async (id) => {
      failOrder.push('forget');
      await forgetJoinCode(port, id);
    },
    onRevoked: () => {
      failOrder.push('clear');
      shown = null;
    },
    issue: async () => {
      failOrder.push('issue');
      assert.equal(shown, null);
      throw new Error('down');
    },
    remember: async () => {
      failOrder.push('remember');
    },
  });
  assert.equal(issueFailed.status, 'issue_failed');
  assert.deepEqual(failOrder, ['revoke', 'forget', 'clear', 'issue']);
  assert.equal(shown, null);
  assert.equal((await readJoinCodeCache(port))[created.id], undefined);
  assert.equal((await fixtureRepo.listJoinCodes(IDS.oak)).some((row) => isActiveJoinCode(row)), false);

  const again = await fixtureRepo.createJoinCode({ siteId: IDS.oak, maxUses: 4, hours: 24 });
  await rememberJoinCode(port, again.id, again.code);
  shown = again.code;
  const order: string[] = [];
  const issued = await confirmThenRegenerate(true, {
    codeId: again.id,
    revoke: async (id) => {
      order.push('revoke');
      await fixtureRepo.revokeJoinCode(id);
    },
    forget: async (id) => {
      order.push('forget');
      await forgetJoinCode(port, id);
    },
    onRevoked: () => {
      order.push('clear');
      shown = null;
    },
    issue: async () => {
      order.push('issue');
      assert.equal(shown, null);
      return fixtureRepo.createJoinCode({ siteId: IDS.oak, maxUses: 4, hours: 24 });
    },
    remember: async (next: JoinCodeCreated) => {
      order.push('remember');
      await rememberJoinCode(port, next.id, next.code);
    },
  });
  assert.equal(issued.status, 'issued');
  assert.deepEqual(order, ['revoke', 'forget', 'clear', 'issue', 'remember']);
  if (issued.status !== 'issued') return;
  assert.notEqual(issued.created.code, again.code);
  assert.equal((await readJoinCodeCache(port))[issued.created.id], issued.created.code);
  assert.equal((await readJoinCodeCache(port))[again.id], undefined);
  const active = (await fixtureRepo.listJoinCodes(IDS.oak)).filter((row) => isActiveJoinCode(row));
  assert.equal(active.length, 1);
  assert.equal(active[0]?.id, issued.created.id);
  const listed = JSON.stringify(active);
  assert.equal(listed.includes(issued.created.code), false);

  await fixtureRepo.signOut();
  const oldJoin = await fixtureRepo
    .joinWithCode({
      code: again.code,
      displayName: 'Old Code',
      trade: 'fixer',
      username: 'oldcode1',
      password: 'fixer123',
    })
    .catch((error: Error) => error.message);
  const fresh = await fixtureRepo.joinWithCode({
    code: issued.created.code,
    displayName: 'New Code',
    trade: 'fixer',
    username: 'newcode1',
    password: 'fixer123',
  });
  assert.equal(oldJoin, 'join_rejected');
  assert.equal(fresh.siteId, IDS.oak);
});

test('sign-out clears the join-code cache, and a lad cannot issue or revoke', async () => {
  const port = memoryPort();
  const id = '66666666-6666-4666-8666-666666666666';
  await rememberJoinCode(port, id, 'K7QM-4XPR');
  await performSignOut({
    signOutLocal: async () => undefined,
    clearStoredSession: async () => undefined,
    clearAppCache: () => clearJoinCodeCache(port),
  });
  assert.equal(port.raw(), null);
  assert.deepEqual(await readJoinCodeCache(port), {});

  const auth = fs.readFileSync(new URL('../context/AuthContext.tsx', import.meta.url), 'utf8');
  const bind = auth.slice(auth.indexOf('async function bindCache'), auth.indexOf('function authTokenKey'));
  assert.match(bind, /else \{[\s\S]*clearJoinCodeCache\(joinCodeCachePort\(\)\)/);
  assert.match(auth, /signOut: async \(\) => \{[\s\S]*clearAppCache: \(\) => bindCache\(null\)/);

  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const created = await fixtureRepo.createJoinCode({ siteId: IDS.oak });
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.createJoinCode({ siteId: IDS.oak }), /not_authorized/);
  await assert.rejects(() => fixtureRepo.revokeJoinCode(created.id), /not_authorized/);
  await assert.rejects(() => fixtureRepo.listJoinCodes(IDS.oak), /not_authorized/);
  for (const file of ['../app/(app)/invite.tsx', '../app/(app)/sites/[siteId]/invite-code.tsx']) {
    const screen = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(screen, /canManageSite/);
    assert.match(screen, /Redirect href="\/sites"/);
  }
});

test('bindCache for a different user drops the previous plaintext', async () => {
  const port = memoryPort();
  const id = '88888888-8888-4888-8888-888888888888';
  const owner = { id: 'user-a' as string | null };
  async function bindCache(userId: string | null) {
    if (userId) {
      await bindJoinCodeCacheOwner(owner.id, userId, port);
      owner.id = userId;
      return;
    }
    await clearJoinCodeCache(port);
    owner.id = null;
  }

  await rememberJoinCode(port, id, 'K7QM-4XPR');
  await bindCache('user-a');
  assert.equal((await readJoinCodeCache(port))[id], 'K7QM-4XPR');
  await bindCache('user-b');
  assert.equal((await readJoinCodeCache(port))[id], undefined);
  assert.deepEqual(await readJoinCodeCache(port), {});

  const auth = fs.readFileSync(new URL('../context/AuthContext.tsx', import.meta.url), 'utf8');
  const bind = auth.slice(auth.indexOf('async function bindCache'), auth.indexOf('function authTokenKey'));
  const clearAt = bind.indexOf('await bindJoinCodeCacheOwner(cacheOwnerUserId(), userId, joinCodeCachePort())');
  const adoptAt = bind.indexOf('await adoptCacheOwner(userId)');
  assert.ok(clearAt > 0 && adoptAt > clearAt);
});

test('web keeps the plaintext in sessionStorage and native uses SecureStore', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true });
  const { joinCodeCachePort } = await import('./joinCodeCacheStorage.ts');
  const port = joinCodeCachePort();
  const id = '77777777-7777-4777-8777-777777777777';
  await rememberJoinCode(port, id, 'K7QM-4XPR');
  const raw = values.get(JOIN_CODE_CACHE_KEY);
  assert.equal(raw, `{"${id}":"K7QM-4XPR"}`);
  await clearJoinCodeCache(port);
  assert.equal(values.has(JOIN_CODE_CACHE_KEY), false);
  Object.defineProperty(globalThis, 'sessionStorage', { value: undefined, configurable: true });

  const web = fs.readFileSync(new URL('./joinCodeCacheStorage.ts', import.meta.url), 'utf8');
  const native = fs.readFileSync(new URL('./joinCodeCacheStorage.native.ts', import.meta.url), 'utf8');
  assert.match(web, /sessionStorage/);
  assert.doesNotMatch(web, /SecureStore|localStorage/);
  assert.match(native, /expo-secure-store/);
  assert.match(native, /SecureStore\.(get|set|delete)ItemAsync/);
  assert.doesNotMatch(native, /sessionStorage|localStorage/);
  assert.doesNotMatch(`${web}\n${native}`, /console\.(log|debug|info|warn|error)/);
});
