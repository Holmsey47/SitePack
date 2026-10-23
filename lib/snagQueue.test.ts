import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PostgrestError } from '@supabase/postgrest-js';
import { snagRpcError, snagStorageError } from '../data/snagFailure.ts';
import {
  flushSnagQueue,
  isRetryableSnagFailure,
  memorySnagQueue,
  persistThenSendSnag,
  rejectedSnagNotice,
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
      coveredIds: ['local-1'],
      outstandingIds: [],
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

test('an unknown business code becomes a notice and a 5xx waits without blocking the queue', async () => {
  assert.equal(isRetryableSnagFailure(new Error('mystery_rule')), false);
  assert.equal(isRetryableSnagFailure(new Error('invalid_time')), false);
  assert.equal(isRetryableSnagFailure(new Error('photo_too_large')), false);
  assert.equal(isRetryableSnagFailure(new Error('snag_locked')), false);
  assert.equal(isRetryableSnagFailure(new Error('snag_list_changed')), false);
  assert.equal(isRetryableSnagFailure(new Error('not_authorized')), false);
  assert.equal(isRetryableSnagFailure(new Error('409')), false);
  assert.equal(isRetryableSnagFailure(new Error('503')), true);
  assert.equal(isRetryableSnagFailure(Object.assign(new Error('down'), { status: 500 })), true);
  assert.equal(isRetryableSnagFailure(Object.assign(new Error('nope'), { status: 422 })), false);
  assert.equal(isRetryableSnagFailure(new TypeError('Failed to fetch')), true);
  assert.equal(
    rejectedSnagNotice('sign', 'snag_list_changed'),
    'The snag list changed before this sign-off was sent. Please sign again.'
  );

  const storage = keyedStorage();
  const queue = storageSnagQueue(storage);
  await queue.put(item([9, 9], 'user-a', 'mystery'));
  await queue.put({ ...item([4], 'user-a', 'five'), raisedAt: '2026-10-22T09:15:00.000Z' });
  await queue.put({
    kind: 'fix',
    localId: 'behind',
    ownerId: 'user-a',
    siteId: 'site',
    companyId: 'company',
    snagId: 'snag-2',
    photos: [{ id: 'p2', contentType: 'image/jpeg', bytes: Uint8Array.from([3]) }],
    fixedAt: '2026-10-22T11:40:00.000Z',
  });
  await queue.put({
    kind: 'sign',
    localId: 'stale-sign',
    ownerId: 'user-a',
    siteId: 'site',
    signedAt: '2026-10-22T13:05:00.000Z',
    mode: 'internal',
    signerCompany: 'Northbuild',
    coveredIds: ['shown-fixed'],
    outstandingIds: ['shown-open'],
  });
  const now = Date.parse('2026-10-22T12:00:00.000Z');
  const calls: string[] = [];
  let fiveCalls = 0;
  const send = async (row: QueuedSnag) => {
    calls.push(row.localId);
    if (row.localId === 'mystery') throw new Error('mystery_rule');
    if (row.localId === 'stale-sign') throw new Error('snag_list_changed');
    if (row.localId === 'five') {
      fiveCalls += 1;
      if (fiveCalls === 1) throw new Error('503');
    }
  };
  await flushSnagQueue(queue, send, 'user-a', () => now);
  assert.deepEqual(calls, ['mystery', 'five', 'behind', 'stale-sign']);
  const waiting = await queue.list();
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0]?.localId, 'five');
  assert.equal(waiting[0]?.attempts, 1);
  assert.equal(waiting[0]?.retryAt, new Date(now + 2000).toISOString());
  const notices = await storageSnagQueue(storage).listNotices();
  const mystery = notices.find((notice) => notice.message === 'This snag was not saved');
  const changed = notices.find((notice) => notice.id.endsWith('stale-sign'));
  assert.equal(changed?.message, 'The snag list changed before this sign-off was sent. Please sign again.');
  const retry = mystery?.retryItem;
  assert.equal(retry?.kind, 'create');
  if (retry?.kind === 'create') assert.deepEqual([...retry.photos[0]!.bytes], [9, 9]);
  calls.length = 0;
  await flushSnagQueue(queue, send, 'user-a', () => now + 1000);
  assert.deepEqual(calls, []);
  await flushSnagQueue(queue, send, 'user-a', () => now + 2000);
  assert.deepEqual(calls, ['five']);
  assert.equal((await queue.list()).length, 0);
  const screen = fs.readFileSync('app/(app)/sites/[siteId]/snags/index.tsx', 'utf8');
  assert.match(screen, /Save photo/);
  assert.match(screen, /Try again/);
  assert.match(screen, /notice\.retryItem \?/);
  assert.doesNotMatch(screen, /notice\.photos\.length > 0 && notice\.retryItem/);
  const signScreen = fs.readFileSync('app/(app)/sites/[siteId]/snags/sign.tsx', 'utf8');
  assert.match(signScreen, /function clearSignFields\(\)/);
  assert.match(signScreen, /setSignature\(null\)/);
});

test('a create retry reuses uploaded paths and drops orphans from a lost response', async () => {
  const queue = memorySnagQueue();
  let uploads = 0;
  let creates = 0;
  const removed: string[] = [];
  const sender: SnagSender = {
    async upload(photo) {
      uploads += 1;
      return { storagePath: `fresh-${uploads}.jpg`, contentType: photo.contentType, fileSizeBytes: photo.bytes.byteLength };
    },
    async create(input) {
      creates += 1;
      if (creates === 1) throw new Error('503');
      if (creates === 2) {
        assert.equal(input.photos[0]?.storagePath, 'fresh-1.jpg');
        return { snagId: 'local-1', alreadyExisted: true, photoPaths: ['fresh-1.jpg'] };
      }
      return { snagId: input.snagId, alreadyExisted: true, photoPaths: ['kept.jpg'] };
    },
    async fix() {},
    async signInternal() {
      return {} as never;
    },
    async signContractor() {
      return {} as never;
    },
    async removePhotos(paths) {
      removed.push(...paths);
    },
  };
  const now = Date.parse('2026-10-22T12:00:00.000Z');
  await queue.put(item([1]));
  await flushSnagQueue(queue, (row) => sendQueuedSnag(row, sender, queue), 'user-a', () => now);
  const stored = await queue.list();
  assert.equal(stored[0]?.kind === 'create' ? stored[0].uploadedPhotos?.[0]?.storagePath : '', 'fresh-1.jpg');
  await flushSnagQueue(queue, (row) => sendQueuedSnag(row, sender, queue), 'user-a', () => now + 2000);
  assert.equal(uploads, 1);
  assert.deepEqual(removed, []);
  assert.equal((await queue.list()).length, 0);

  const orphans = memorySnagQueue();
  await sendQueuedSnag(item([2], 'user-a', 'other'), sender, orphans);
  assert.deepEqual(removed, ['fresh-2.jpg']);
});

test('real network, 503, and storage unknown stay queued, and a business code does not', async () => {
  const shapes = [
    new TypeError('Failed to fetch'),
    new TypeError('Network request failed'),
    Object.assign(new PostgrestError({ message: 'Service Unavailable', details: '', hint: '', code: 'PGRST000' }), { status: 503 }),
  ];
  for (const shape of shapes) {
    let thrown: unknown;
    try {
      throw snagRpcError(shape);
    } catch (err) {
      thrown = err;
    }
    assert.equal(isRetryableSnagFailure(thrown), true, shape instanceof Error ? shape.message : 'shape');
    assert.equal(isRetryableSnagFailure(shape), true);
  }
  let stored: unknown;
  try {
    throw snagStorageError(new Error('unknown'));
  } catch (err) {
    stored = err;
  }
  assert.equal(isRetryableSnagFailure(stored), true);
  assert.equal(isRetryableSnagFailure(new Error('unknown')), true);
  let business: unknown;
  try {
    throw snagRpcError(new PostgrestError({ message: 'not_authorized', details: '', hint: '', code: 'P0001' }));
  } catch (err) {
    business = err;
  }
  assert.equal(isRetryableSnagFailure(business), false);
  assert.equal(business instanceof Error ? business.message : '', 'not_authorized');

  const queue = memorySnagQueue();
  await queue.put({
    kind: 'sign',
    localId: 'sign-net',
    ownerId: 'user-a',
    siteId: 'site',
    signedAt: '2026-10-22T13:05:00.000Z',
    mode: 'contractor',
    signerName: 'Dave Moran',
    signerRole: 'Site manager',
    signerCompany: 'Northbuild',
    signaturePng: 'data:image/png;base64,aaaa',
    coveredIds: ['fixed-1'],
    outstandingIds: [],
  });
  const now = Date.parse('2026-10-22T12:00:00.000Z');
  await flushSnagQueue(queue, async () => {
    throw snagRpcError(new TypeError('Failed to fetch'));
  }, 'user-a', () => now);
  const waiting = await queue.list();
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0]?.kind === 'sign' ? waiting[0].signaturePng : '', 'data:image/png;base64,aaaa');
  assert.equal((await queue.listNotices()).length, 0);

  await flushSnagQueue(queue, async () => {
    throw snagRpcError(new PostgrestError({ message: 'not_authorized', details: '', hint: '', code: 'P0001' }));
  }, 'user-a', () => now + 2000);
  assert.equal((await queue.list()).length, 0);
  const notice = (await queue.listNotices())[0];
  assert.equal(notice?.message, 'This sign-off was not saved');
  assert.equal(notice?.retryItem?.kind, 'sign');
  assert.equal(notice?.retryItem?.kind === 'sign' ? notice.retryItem.signaturePng : '', 'data:image/png;base64,aaaa');
});

test('a path refusal re-uploads, and a queued fix changes the list-changed notice', async () => {
  const queue = memorySnagQueue();
  const queued = item([7]);
  queued.uploadedPhotos = [{ storagePath: 'bad/path.jpg', contentType: 'image/jpeg', fileSizeBytes: 7 }];
  await queue.put(queued);
  await queue.put({
    kind: 'fix',
    localId: 'fix-waiting',
    ownerId: 'user-a',
    siteId: 'site',
    companyId: 'company',
    snagId: 'snag-2',
    photos: [{ id: 'p2', contentType: 'image/jpeg', bytes: Uint8Array.from([3]) }],
    fixedAt: '2026-10-22T11:40:00.000Z',
    attempts: 1,
    retryAt: '2026-10-22T12:00:05.000Z',
  });
  await queue.put({
    kind: 'sign',
    localId: 'sign-stale',
    ownerId: 'user-a',
    siteId: 'site',
    signedAt: '2026-10-22T13:05:00.000Z',
    mode: 'internal',
    signerCompany: 'Ashfield Finishes',
    coveredIds: ['shown-fixed'],
    outstandingIds: ['shown-open'],
  });
  const now = Date.parse('2026-10-22T12:00:00.000Z');
  await flushSnagQueue(queue, async (row) => {
    if (row.localId === 'local-1') throw new Error('invalid_path');
    if (row.kind === 'sign') throw new Error('snag_list_changed');
  }, 'user-a', () => now);
  const notices = await queue.listNotices();
  const pathNotice = notices.find((notice) => notice.retryItem?.localId === 'local-1');
  assert.equal(pathNotice?.retryItem?.kind === 'create' ? pathNotice.retryItem.uploadedPhotos : 'no', undefined);
  const changed = notices.find((notice) => notice.retryItem?.localId === 'sign-stale');
  assert.equal(changed?.message, "A fix you made is still sending. Wait until it's sent, then sign again.");
  assert.equal((await queue.list()).some((row) => row.localId === 'fix-waiting'), true);
});
