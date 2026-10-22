import assert from 'node:assert/strict';
import test from 'node:test';
import { SAVED_ON_PHONE } from './variationQueue.ts';
import { memoryVariationQueue, persistThenSend, storageVariationQueue, type QueuedVariation } from './variationQueue.ts';

function item(bytes: number[]): QueuedVariation {
  return {
    localId: 'local-1',
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
  await storageVariationQueue(storage).put(queued);
  const again = await storageVariationQueue(storage).list();
  assert.equal(again[0]?.photos.length, 3);
  assert.deepEqual([...again[0]!.photos[0]!.bytes], [1, 2, 3, 4]);
});
