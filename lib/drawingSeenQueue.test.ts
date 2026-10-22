import assert from 'node:assert/strict';
import test from 'node:test';
import {
  flushDrawingSeenQueue,
  memoryDrawingSeenQueue,
  orderedQueue,
  queueSeenTap,
  rejectedTapNotice,
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
  const notices = await flushDrawingSeenQueue(queue, {
    async recordOpen(drawingId) {
      calls.push(`open:${drawingId}`);
      if (drawingId === 'old') throw new Error('not_current');
    },
    async confirm(drawingId, seenAt) {
      calls.push(`confirm:${drawingId}:${seenAt}`);
      if (drawingId === 'old') throw new Error('not_current');
    },
    async currentRevision(item) {
      return item.drawingId === 'old' ? 'C' : null;
    },
  });
  assert.deepEqual(calls, [
    'open:old',
    'open:new',
    'confirm:old:2026-10-22T10:00:00.000Z',
    'confirm:new:2026-10-22T10:05:00.000Z',
  ]);
  assert.deepEqual(
    notices.map((notice) => notice.message),
    ['Rev B was replaced — open rev C']
  );
  assert.equal((await queue.list()).length, 0);
  assert.equal((await queue.listNotices())[0]?.message, 'Rev B was replaced — open rev C');

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

test('a refused queued tap is kept as a notice', async () => {
  const queue = memoryDrawingSeenQueue();
  await queue.put({
    id: 'confirm:gone',
    kind: 'confirm',
    drawingId: 'gone',
    siteId: 's1',
    revision: 'B',
    at: '2026-10-22T10:00:00.000Z',
  });
  const notices = await flushDrawingSeenQueue(queue, {
    async recordOpen() {
      return undefined;
    },
    async confirm() {
      throw new Error('drawing_not_found');
    },
  });
  assert.equal(rejectedTapNotice('B', 'not_authorized'), 'Rev B was not saved');
  assert.equal(notices[0]?.message, 'Rev B is gone — open the current sheet');
  assert.equal((await queue.list()).length, 0);
  assert.equal((await queue.listNotices()).length, 1);
});
