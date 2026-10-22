import assert from 'node:assert/strict';
import test from 'node:test';
import { memorySnagQueue, persistThenSendSnag, storageSnagQueue, type QueuedSnagCreate } from './snagQueue.ts';
import { sendQueuedSnag, type SnagSender } from './sendQueuedSnag.ts';

function item(bytes: number[]): QueuedSnagCreate {
  return {
    kind: 'create',
    localId: 'local-1',
    siteId: 'site',
    companyId: 'company',
    note: 'Bead missing',
    levelArea: 'Ground',
    tradeLabel: 'dryliner',
    photos: [{ id: 'p1', contentType: 'image/jpeg', bytes: Uint8Array.from(bytes) }],
    raisedAt: '2026-10-22T08:15:00.000Z',
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
  assert.equal(stored[0].raisedAt, '2026-10-22T08:15:00.000Z');
  assert.deepEqual([...stored[0].photos[0]!.bytes], [9, 8, 7, 6]);

  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
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
      return { snagId: 'server-1' };
    },
    async fix(_id, fixedAt) {
      seen.push(fixedAt);
    },
    async signManager(_id, signedAt) {
      seen.push(signedAt);
    },
    async signContractor(_id, signedAt) {
      seen.push(signedAt);
    },
  };
  const queue = memorySnagQueue();
  await sendQueuedSnag(item([1]), sender, queue);
  const stored = await queue.list();
  assert.equal(stored[0]?.kind === 'create' ? stored[0].serverSnagId : '', 'server-1');
  await sendQueuedSnag(
    {
      kind: 'fix',
      localId: 'fix-1',
      siteId: 'site',
      companyId: 'company',
      snagId: 'server-1',
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
      siteId: 'site',
      snagId: 'server-1',
      signedAt: '2026-10-22T13:05:00.000Z',
      mode: 'manager',
    },
    sender,
    queue
  );
  assert.deepEqual(seen, ['2026-10-22T08:15:00.000Z', '2026-10-22T11:40:00.000Z', '2026-10-22T13:05:00.000Z']);
});
