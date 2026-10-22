import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  claimCacheSession,
  createCacheSession,
  editOwnedCache,
  finishClaim,
  forgetSessionCache,
  readOwned,
  writePackFiles,
  writeStillCurrent,
} from './offlineGuard.ts';
import { coldStartCache, userCheckOutcome, userIdFromStoredSession } from './sessionBoot.ts';

function ownedSession(userId: string) {
  const session = createCacheSession();
  assert.equal(claimCacheSession(session, userId), 'replaced');
  assert.equal(finishClaim(session, userId, session.generation), true);
  return session;
}

test('sign-out wipes the drawing cache', () => {
  const session = ownedSession('alice');
  const sites = ['oak'];
  const files = new Set(['oak/sheet']);
  forgetSessionCache(session, () => {
    sites.length = 0;
    files.clear();
  });
  assert.deepEqual(sites, []);
  assert.equal(files.size, 0);
  assert.equal(session.userId, null);
  assert.equal(session.ownerUserId, null);
  const read = readOwned(session, () => ['oak'], [] as string[]);
  assert.deepEqual(read.value, []);
  assert.equal(read.wipe, false);
});

test('session expiry wipes the drawing cache', () => {
  const session = ownedSession('user-alice');
  const sites = ['site-oak'];
  forgetSessionCache(session, () => {
    sites.length = 0;
  });
  assert.deepEqual(sites, []);
  assert.equal(session.userId, null);
  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  const listener = auth.slice(auth.indexOf('onAuthStateChange'), auth.indexOf('const started = await restoreStoredSession'));
  assert.match(listener, /if \(!live\) \{[\s\S]*bindCache\(null\)/);
  assert.match(listener, /coldStartCache/);
  assert.match(auth, /async function bindCache\(userId: string \| null\) \{[\s\S]*deleteAllDrawingCaches/);
  assert.match(auth, /signOut: async \(\) => \{[\s\S]*bindCache\(null\)/);
});

test('a read wipes when the owner is missing or is a different user, and does not return the cache', () => {
  const missing = createCacheSession();
  missing.userId = 'bob';
  const stored = ['oak'];
  const missed = readOwned(missing, () => stored, [] as string[]);
  assert.equal(missed.wipe, true);
  assert.deepEqual(missed.value, []);

  const other = ownedSession('alice');
  other.userId = 'bob';
  const crossed = readOwned(other, () => stored, [] as string[]);
  assert.equal(crossed.wipe, true);
  assert.deepEqual(crossed.value, []);
  assert.equal(other.ownerUserId, null);
  assert.equal(other.ownerUserId === 'alice', false);

  const same = ownedSession('alice');
  const kept = readOwned(same, () => stored, [] as string[]);
  assert.equal(kept.wipe, false);
  assert.deepEqual(kept.value, ['oak']);
  assert.equal(claimCacheSession(same, 'alice'), 'kept');
  const offline = fs.readFileSync('lib/offline.ts', 'utf8');
  assert.match(offline, /readOwned/);
  assert.match(offline, /owner\.json/);
  assert.match(offline, /adoptCacheOwner/);
});

test('a download cancelled by a wipe does not commit and discards the file it just wrote', async () => {
  const session = ownedSession('alice');
  const started = session.generation;
  const user = session.userId;
  const files = new Set<string>();
  let committed = false;
  const outcome = await writePackFiles({
    allowed: () => writeStillCurrent(session, started, user),
    items: ['a', 'b'],
    write: async (id) => {
      files.add(id);
      if (id === 'a') forgetSessionCache(session, () => undefined);
    },
    discard: async (id) => {
      files.delete(id);
    },
    commit: () => {
      committed = true;
    },
  });
  assert.equal(outcome, 'cancelled');
  assert.equal(committed, false);
  assert.equal(files.has('a'), false);
  assert.equal(files.has('b'), false);
  const offline = fs.readFileSync('lib/offline.ts', 'utf8');
  assert.match(offline, /writePackFiles/);
  assert.match(offline, /writeStillCurrent/);
});

test('an offline cold start with a stored session keeps that user cache', () => {
  const session = ownedSession('user-shaun');
  const files = new Set(['site-oak/sheet-1']);
  const stored = userIdFromStoredSession('{"user":{"id":"user-shaun"}}');
  assert.equal(userCheckOutcome({ name: 'AuthRetryableFetchError', status: 0 }, false), 'offline');
  const start = coldStartCache(stored, 'offline');
  assert.equal(start.wipe, false);
  assert.equal(start.userId, 'user-shaun');
  assert.equal(claimCacheSession(session, start.userId ?? ''), 'kept');
  assert.equal(files.size, 1);
  const read = readOwned(session, () => ['site-oak'], [] as string[]);
  assert.equal(read.wipe, false);
  assert.deepEqual(read.value, ['site-oak']);
  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  const boot = auth.slice(auth.indexOf('async function restoreStoredSession'), auth.indexOf('export function AuthProvider'));
  assert.match(boot, /readStoredSessionUser/);
  assert.match(boot, /coldStartCache/);
  assert.doesNotMatch(boot, /bindCache\(null\)/);
});

test('an online start with no stored session wipes the cache', () => {
  const session = ownedSession('user-shaun');
  const files = new Set(['site-oak/sheet-1']);
  assert.equal(userIdFromStoredSession(null), null);
  const start = coldStartCache(null, 'ok');
  assert.equal(start.wipe, true);
  assert.equal(start.userId, null);
  forgetSessionCache(session, () => {
    files.clear();
  });
  assert.equal(files.size, 0);
  assert.equal(session.userId, null);
  assert.equal(coldStartCache('user-shaun', 'rejected').wipe, true);
  assert.equal(userCheckOutcome({ name: 'AuthSessionMissingError', status: 400 }, false), 'rejected');
  assert.equal(userCheckOutcome({ name: 'AuthApiError', status: 401, code: 'bad_jwt' }, false), 'rejected');
});

test('a stored session with a different owner wipes before any read', () => {
  const session = ownedSession('user-alice');
  const files = new Set(['site-oak/sheet-1']);
  const start = coldStartCache('user-bob', 'offline');
  assert.equal(start.wipe, false);
  assert.equal(start.userId, 'user-bob');
  assert.equal(claimCacheSession(session, start.userId ?? ''), 'replaced');
  assert.equal(session.ownerUserId, null);
  const generation = session.generation;
  files.clear();
  assert.equal(finishClaim(session, 'user-bob', generation), true);
  let loaded = false;
  const read = readOwned(session, () => {
    loaded = true;
    return [...files];
  }, [] as string[]);
  assert.equal(loaded, true);
  assert.equal(read.wipe, false);
  assert.deepEqual(read.value, []);
  assert.equal(files.has('site-oak/sheet-1'), false);
});

test('deleteSupersededDrawings is refused for another owner and aborted when the cache is wiped mid-run', async () => {
  let removed = false;
  let committed = false;
  const refused = await editOwnedCache({
    allowed: () => false,
    mutate: async () => {
      removed = true;
    },
    commit: () => {
      committed = true;
    },
  });
  assert.equal(refused, 'cancelled');
  assert.equal(removed, false);
  assert.equal(committed, false);

  const session = ownedSession('user-alice');
  const started = session.generation;
  const user = session.userId;
  const dropped: string[] = [];
  let saved = false;
  const aborted = await editOwnedCache({
    allowed: () => writeStillCurrent(session, started, user),
    mutate: async () => {
      for (const id of ['sheet-a', 'sheet-b']) {
        if (!writeStillCurrent(session, started, user)) return;
        dropped.push(id);
        if (id === 'sheet-a') forgetSessionCache(session, () => undefined);
      }
    },
    commit: () => {
      saved = true;
    },
  });
  assert.equal(aborted, 'cancelled');
  assert.equal(saved, false);
  assert.deepEqual(dropped, ['sheet-a']);

  const offline = fs.readFileSync('lib/offline.ts', 'utf8');
  const fn = offline.slice(
    offline.indexOf('export async function deleteSupersededDrawings'),
    offline.indexOf('export async function downloadCurrentPack')
  );
  assert.match(fn, /if \(!canReadCache\(\)\) return/);
  assert.match(fn, /writeStillCurrent/);
  assert.match(fn, /editOwnedCache/);
  assert.match(fn, /removeDrawingFiles\(siteId, dropIds, currentIds, allowed\)/);
  const remover = offline.slice(offline.indexOf('async function removeDrawingFiles'), offline.indexOf('export async function deleteSiteCache'));
  assert.match(remover, /if \(!allowed\(\)\) return/);
});
