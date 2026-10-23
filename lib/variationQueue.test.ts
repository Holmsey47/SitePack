import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { SAVED_ON_PHONE } from './variationQueue.ts';
import {
  clearVariationQueue,
  flushVariationQueue,
  memoryVariationQueue,
  persistThenSend,
  storageVariationQueue,
  type QueuedVariation,
} from './variationQueue.ts';

function item(bytes: number[], ownerUserId = 'user-a', localId = 'local-1'): QueuedVariation {
  return {
    localId,
    siteId: 'site',
    companyId: 'company',
    title: 'Extra beads',
    description: 'Note',
    levelArea: null,
    quantityText: null,
    valuePence: null,
    photos: [
      { id: 'p1', contentType: 'image/jpeg', bytes: Uint8Array.from(bytes) },
      { id: 'p2', contentType: 'image/jpeg', bytes: Uint8Array.from(bytes.map((value) => value + 1)) },
      { id: 'p3', contentType: 'image/jpeg', bytes: Uint8Array.from(bytes.map((value) => value + 2)) },
    ],
    savedAt: '2026-10-22T13:00:00.000Z',
    ownerUserId,
    notice: SAVED_ON_PHONE,
  };
}

function mapStorage() {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
      keys: () => [...map.keys()],
    },
  };
}

test('a queued variation keeps every photo when the phone is offline or the send fails', async () => {
  assert.equal(SAVED_ON_PHONE, 'Saved on phone, will send');
  const memory = memoryVariationQueue();
  const queued = item([1, 2, 3, 4]);
  const offline = await persistThenSend(queued, false, async () => {
    throw new Error('should not send');
  }, memory);
  assert.equal(offline, 'queued');
  const stored = await memory.list();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.photos.length, 3);
  assert.deepEqual([...stored[0]!.photos[2]!.bytes], [3, 4, 5, 6]);

  const failed = await persistThenSend(queued, true, async () => {
    throw new Error('offline');
  }, memory);
  assert.equal(failed, 'queued');
  assert.equal((await memory.list()).length, 1);

  const { storage } = mapStorage();
  await storageVariationQueue(storage).put(queued);
  const again = await storageVariationQueue(storage).list();
  assert.equal(again[0]?.photos.length, 3);
  assert.equal(again[0]?.ownerUserId, 'user-a');
  assert.equal(again[0]?.notice, SAVED_ON_PHONE);
  assert.deepEqual([...again[0]!.photos[0]!.bytes], [1, 2, 3, 4]);
});

test('a wipe drops the queued variation before the next user can send it', async () => {
  const { map, storage } = mapStorage();
  const queue = storageVariationQueue(storage);
  await queue.put(item([1, 2, 3, 4], 'user-a'));
  assert.equal((await queue.list()).length, 1);
  await clearVariationQueue(storage);
  let calls = 0;
  const left = await flushVariationQueue('user-b', 'site', true, async () => {
    calls += 1;
  }, storageVariationQueue(storage));
  assert.equal(calls, 0);
  assert.equal(left.length, 0);
  assert.equal([...map.keys()].length, 0);
  const offline = fs.readFileSync('lib/offline.ts', 'utf8');
  assert.match(offline, /clearVariationQueue/);
  assert.match(offline, /sitepack\.variation\./);
});

test("without a wipe, another user's queued variation is dropped and not sent", async () => {
  const memory = memoryVariationQueue();
  await memory.put(item([9, 8, 7], 'user-a', 'a-1'));
  let calls = 0;
  const left = await flushVariationQueue('user-b', 'site', true, async () => {
    calls += 1;
  }, memory);
  assert.equal(calls, 0);
  assert.equal(left.length, 0);
  assert.equal((await memory.list()).length, 0);
});
