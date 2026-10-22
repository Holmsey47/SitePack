import assert from 'node:assert/strict';
import test from 'node:test';
import {
  flushDrawingSeenQueue,
  memoryDrawingSeenQueue,
  orderedQueue,
  queueSeenTap,
  SAVED_ON_PHONE,
  storageDrawingSeenQueue,
} from './drawingSeenQueue.ts';

test('an offline tap queues the open before the confirmation', async () => {
  const queue = memoryDrawingSeenQueue();
  assert.equal(
    await queueSeenTap(queue, {
      drawingId: 'd1',
      siteId: 's1',
      revision: 'C',
      at: '2026-10-22T10:00:00.000Z',
      opened: false,
    }),
    'not_opened'
  );
  assert.equal((await queue.list()).length, 0);
  assert.equal(
    await queueSeenTap(queue, {
      drawingId: 'd1',
      siteId: 's1',
      revision: 'C',
      at: '2026-10-22T10:00:00.000Z',
      opened: true,
    }),
    'queued'
  );
  assert.equal(SAVED_ON_PHONE, 'Saved on phone, will send');
  const order = orderedQueue(await queue.list()).map((item) => item.kind);
  assert.deepEqual(order, ['open', 'confirm']);
});

test('sync sends the open first and drops a superseded revision', async () => {
  const storage = new Map<string, string>();
  const queue = storageDrawingSeenQueue({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
    removeItem: (key) => {
      storage.delete(key);
    },
  });
  await queueSeenTap(queue, {
    drawingId: 'old',
    siteId: 's1',
    revision: 'B',
    at: '2026-10-22T10:00:00.000Z',
    opened: true,
  });
  await queueSeenTap(queue, {
    drawingId: 'new',
    siteId: 's1',
    revision: 'C',
    at: '2026-10-22T10:05:00.000Z',
    opened: true,
  });
  const calls: string[] = [];
  await flushDrawingSeenQueue(queue, {
    async recordOpen(drawingId) {
      calls.push(`open:${drawingId}`);
      if (drawingId === 'old') throw new Error('not_current');
    },
    async confirm(drawingId) {
      calls.push(`confirm:${drawingId}`);
      if (drawingId === 'old') throw new Error('not_current');
    },
  });
  assert.deepEqual(calls, ['open:old', 'open:new', 'confirm:old', 'confirm:new']);
  assert.equal((await queue.list()).length, 0);

  const again = storageDrawingSeenQueue({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
    removeItem: (key) => {
      storage.delete(key);
    },
  });
  await again.put({
    id: 'confirm:stuck',
    kind: 'confirm',
    drawingId: 'stuck',
    siteId: 's1',
    revision: 'C',
    at: '2026-10-22T11:00:00.000Z',
  });
  let opens = 0;
  await flushDrawingSeenQueue(again, {
    async recordOpen() {
      opens += 1;
    },
    async confirm() {
      if (opens === 0) throw new Error('not_opened');
    },
  });
  assert.equal(opens, 1);
  assert.equal((await again.list()).length, 0);
});
