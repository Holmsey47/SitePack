import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  flushSnagQueue,
  memorySnagQueue,
  persistThenSendSnag,
  removeSnagQueueKeys,
  storageSnagQueue,
  type QueuedSnag,
  type QueuedSnagCreate,
  type SnagQueueStore,
} from './snagQueue.ts';
import { sendQueuedSnag, type SnagSender } from './sendQueuedSnag.ts';

function item(bytes: number[], ownerId = 'user-a', localId = 'local-1'): QueuedSnagCreate {
  return {
    kind: 'create',
    localId,
    ownerId,
    siteId: 'site',
    companyId: 'company',
    note: 'Bead missing',
    levelArea: 'Ground',
    tradeLabel: 'dryliner',
    photos: [{ id: 'p1', contentType: 'image/jpeg', bytes: Uint8Array.from(bytes) }],
    raisedAt: '2026-10-22T08:15:00.000Z',
  };
}

function keyedStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    get length() {
      return map.size;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
  };
}

test('a queued snag keeps the photo and the original raised time', async () => {
  const memory = memorySnagQueue();
  const queued = item([9, 8, 7, 6]);
  const offline = await persistThenSendSnag(queued, false, async () => {
    throw new Error('should not send');
  }, memory);
  assert.equal(offline, 'queued');
  const stored = await memory.list();
  assert.equal(stored[0]?.kind, 'create');
  if (stored[0]?.kind !== 'create') return;
  assert.equal(stored[0].ownerId, 'user-a');
  assert.equal(stored[0].raisedAt, '2026-10-22T08:15:00.000Z');
  assert.deepEqual([...stored[0].photos[0]!.bytes], [9, 8, 7, 6]);

  const storage = keyedStorage();
  await storageSnagQueue(storage).put(queued);
  const again = await storageSnagQueue(storage).list();
  assert.equal(again[0]?.kind === 'create' ? again[0].raisedAt : '', '2026-10-22T08:15:00.000Z');
  assert.deepEqual(again[0]?.kind === 'create' ? [...again[0].photos[0]!.bytes] : [], [9, 8, 7, 6]);
});

test('sending a queued snag uses the original device times', async () => {
  const seen: string[] = [];
  const sender: SnagSender = {
    async upload(photo) {
      return { storagePath: 'co/site/snags/a.jpg', contentType: photo.contentType, fileSizeBytes: photo.bytes.byteLength };
    },
    async create(input) {
      seen.push(input.raisedAt);
      assert.equal(input.snagId, 'local-1');
      return { snagId: 'local-1' };
    },
    async fix(_id, fixedAt) {
      seen.push(fixedAt);
    },
    async signInternal(input) {
      seen.push(input.signedAt);
      return {} as never;
    },
    async signContractor() {
      return {} as never;
    },
  };
  const queue = memorySnagQueue();
  await sendQueuedSnag(item([1]), sender, queue);
  const stored = await queue.list();
  assert.equal(stored[0]?.kind === 'create' ? stored[0].serverSnagId : '', 'local-1');
  await sendQueuedSnag(
    {
      kind: 'fix',
      localId: 'fix-1',
      ownerId: 'user-a',
      siteId: 'site',
      companyId: 'company',
      snagId: 'local-1',
      photos: [{ id: 'p2', contentType: 'image/jpeg', bytes: Uint8Array.from([2]) }],
      fixedAt: '2026-10-22T11:40:00.000Z',
    },
    sender,
    queue
  );
  await sendQueuedSnag(
    {
      kind: 'sign',
      localId: 'sign-1',
      ownerId: 'user-a',
      siteId: 'site',
      signedAt: '2026-10-22T13:05:00.000Z',
      mode: 'internal',
      signerCompany: 'Northbuild',
    },
    sender,
    queue
  );
  assert.deepEqual(seen, ['2026-10-22T08:15:00.000Z', '2026-10-22T11:40:00.000Z', '2026-10-22T13:05:00.000Z']);
});

test('a wiped snag queue is not sent for the next signed-in user', async () => {
  const storage = keyedStorage();
  const queue = storageSnagQueue(storage);
  await queue.put(item([1, 2, 3]));
  removeSnagQueueKeys(storage);
  const calls: string[] = [];
  await flushSnagQueue(storageSnagQueue(storage), async (row) => {
    calls.push(row.localId);
  }, 'user-b');
  assert.deepEqual(calls, []);
  assert.equal((await storageSnagQueue(storage).list()).length, 0);

  const offline = fs.readFileSync('lib/offline.ts', 'utf8');
  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  assert.match(offline, /function clearLocalMetadata\(\) \{[\s\S]*removeSnagQueueKeys\(store\)/);
  assert.match(offline, /function clearLocalMetadata\(\) \{[\s\S]*deleteSnagIndexedDb\(\)/);
  assert.match(offline, /function clearLocalMetadata\(\) \{[\s\S]*removeDrawingSeenKeys\(store\)/);
  assert.match(offline, /sitepack\.variation\./);
  assert.match(offline, /clearVariationQueue\(\)/);
  assert.doesNotMatch(offline, /function clearLocalMetadata\(\) \{[\s\S]*if \(!store\) return;/);
  assert.match(fs.readFileSync('lib/snagQueue.ts', 'utf8'), /export \{ SAVED_ON_PHONE, deviceIsOnline \} from '@\/lib\/variationQueue'/);
  assert.match(fs.readFileSync('lib/variationQueue.ts', 'utf8'), /if \(fixtureForceOffline\(\)\) return false/);
  assert.match(fs.readFileSync('scripts/throwaway-auth.sql', 'utf8'), /grant all on functions to anon, authenticated, service_role/);
  assert.match(auth, /deleteAllDrawingCaches/);
  assert.match(auth, /bindCache\(null\)/);
});

test("a flush for one user drops another user's queued snag without a server call", async () => {
  const queue = memorySnagQueue();
  await queue.put(item([4, 5], 'user-a', 'from-a'));
  await queue.put(item([6], 'user-b', 'from-b'));
  const calls: string[] = [];
  await flushSnagQueue(queue, async (row) => {
    calls.push(row.localId);
  }, 'user-b');
  assert.deepEqual(calls, ['from-b']);
  const left = await queue.list();
  assert.equal(left.length, 0);
});

test('a refused queued snag becomes a notice and does not block the next item', async () => {
  const queue: SnagQueueStore = memorySnagQueue();
  await queue.put(item([9, 9], 'user-a', 'refused'));
  await queue.put({
    kind: 'fix',
    localId: 'later-fix',
    ownerId: 'user-a',
    siteId: 'site',
    companyId: 'company',
    snagId: 'snag-2',
    photos: [{ id: 'p2', contentType: 'image/jpeg', bytes: Uint8Array.from([3, 3]) }],
    fixedAt: '2026-10-22T11:40:00.000Z',
  });
  const calls: string[] = [];
  await flushSnagQueue(queue, async (row: QueuedSnag) => {
    calls.push(row.localId);
    if (row.localId === 'refused') throw new Error('not_authorized');
  }, 'user-a');
  assert.deepEqual(calls, ['refused', 'later-fix']);
  assert.equal((await queue.list()).length, 0);
  const notices = await queue.listNotices();
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.message, 'This snag was not saved');
  assert.deepEqual([...(notices[0]?.photos[0]?.bytes ?? [])], [9, 9]);
  await queue.removeNotice(notices[0]!.id);
  assert.equal((await queue.listNotices()).length, 0);
});
