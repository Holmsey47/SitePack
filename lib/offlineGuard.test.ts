import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  claimCacheSession,
  createCacheSession,
  finishClaim,
  forgetSessionCache,
  readOwned,
  writePackFiles,
  writeStillCurrent,
} from './offlineGuard.ts';

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
  const session = ownedSession('alice');
  const sites = ['oak'];
  forgetSessionCache(session, () => {
    sites.length = 0;
  });
  assert.deepEqual(sites, []);
  assert.equal(session.userId, null);
  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  const listener = auth.slice(auth.indexOf('onAuthStateChange'), auth.indexOf('const me = await repo.restoreSession'));
  assert.match(listener, /if \(!session\?\.user\?\.id\) \{[\s\S]*bindCache\(null\)/);
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
