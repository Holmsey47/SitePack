import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { currentSheetId, replacedNoticePath } from '../data/drawingSeen.ts';
import {
  dismissNoticesForOpenedSheet,
  flushDrawingSeenQueue,
  memoryDrawingSeenQueue,
  noticesForOwner,
  orderedQueue,
  queueSeenTap,
  rejectedTapNotice,
  rememberRejectedTap,
  removeDrawingSeenKeys,
  SAVED_ON_PHONE,
  storageDrawingSeenQueue,
} from './drawingSeenQueue.ts';

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

function keyedStorage() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
    get length() {
      return rows.size;
    },
    key(index: number) {
      return [...rows.keys()][index] ?? null;
    },
  };
}

test('an offline tap queues the open before the confirmation', async () => {
  const queue = memoryDrawingSeenQueue();
  assert.equal(
    await queueSeenTap(queue, {
      ownerId: OWNER_A,
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
      ownerId: OWNER_A,
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
    ownerId: OWNER_A,
    drawingId: 'old',
    siteId: 's1',
    revision: 'B',
    at: '2026-10-22T10:00:00.000Z',
    opened: true,
  });
  await queueSeenTap(queue, {
    ownerId: OWNER_A,
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
  }, OWNER_A);
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
    ownerId: OWNER_A,
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
  }, OWNER_A);
  assert.equal(opens, 1);
  assert.equal((await again.list()).length, 0);
});

test('a refused queued tap is kept as a notice', async () => {
  const queue = memoryDrawingSeenQueue();
  await queue.put({
    id: 'confirm:gone',
    ownerId: OWNER_A,
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
  }, OWNER_A);
  assert.equal(rejectedTapNotice('B', 'not_authorized'), 'Rev B was not saved');
  assert.equal(rejectedTapNotice('B', 'drawing_not_found'), 'Rev B was not saved');
  assert.equal(notices[0]?.message, 'Rev B was not saved');
  assert.equal((await queue.list()).length, 0);
  assert.equal((await queue.listNotices()).length, 1);
});

test('a wiped seen queue is not sent for the next signed-in user', async () => {
  const storage = keyedStorage();
  const queue = storageDrawingSeenQueue(storage);
  assert.equal(
    await queueSeenTap(queue, {
      ownerId: OWNER_A,
      drawingId: 'd1',
      siteId: 's1',
      revision: 'C',
      at: '2026-10-22T10:00:00.000Z',
      opened: true,
    }),
    'queued'
  );
  assert.equal((await queue.list()).length, 2);
  await queue.putNotice({
    id: 'notice-a',
    ownerId: OWNER_A,
    siteId: 's1',
    drawingId: 'd1',
    revision: 'C',
    message: 'Rev C was replaced — open rev D',
  });
  assert.ok(storage.getItem('sitepack.drawingSeen.notices')?.includes(OWNER_A));
  removeDrawingSeenKeys(storage);
  assert.equal(storage.length, 0);
  assert.equal(storage.getItem('sitepack.drawingSeen.queue'), null);
  assert.equal(storage.getItem('sitepack.drawingSeen.notices'), null);
  assert.equal((await queue.list()).length, 0);
  const calls: string[] = [];
  await flushDrawingSeenQueue(
    storageDrawingSeenQueue(storage),
    {
      async recordOpen(drawingId) {
        calls.push(`open:${drawingId}`);
      },
      async confirm(drawingId) {
        calls.push(`confirm:${drawingId}`);
      },
    },
    OWNER_B
  );
  assert.deepEqual(calls, []);
  assert.equal((await queue.list()).length, 0);

  const offline = fs.readFileSync('lib/offline.ts', 'utf8');
  assert.match(offline, /function clearLocalMetadata\(\) \{[\s\S]*removeDrawingSeenKeys\(store\)/);
  assert.match(offline, /export async function deleteAllDrawingCaches[\s\S]*forgetSessionCache\(session, clearLocalMetadata\)/);
  assert.match(offline, /export async function adoptCacheOwner[\s\S]*clearLocalMetadata\(\)/);
  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  assert.match(auth, /async function bindCache\(userId: string \| null\) \{[\s\S]*deleteAllDrawingCaches/);
  assert.match(auth, /if \(!live\) \{[\s\S]*bindCache\(null\)/);
  assert.match(auth, /signOut: async \(\) => \{[\s\S]*bindCache\(null\)/);
});

test('tapping the notice navigates to the current-rev sheet and the notice is gone afterwards', async () => {
  const queue = memoryDrawingSeenQueue();
  await queue.putNotice({
    id: 'notice-a',
    ownerId: OWNER_A,
    siteId: 'site',
    drawingId: 'old',
    revision: 'A',
    message: 'Rev A was replaced — open rev B',
  });
  const drawings = [
    { id: 'old', supersedes_id: null, is_current: false },
    { id: 'next', supersedes_id: 'old', is_current: true },
  ];
  const sheetId = currentSheetId(drawings, 'old');
  assert.equal(sheetId, 'next');
  assert.equal(replacedNoticePath('site', sheetId ?? ''), '/sites/site/drawing/next');
  await dismissNoticesForOpenedSheet(queue, OWNER_A, 'next', drawings);
  assert.equal((await queue.listNotices()).length, 0);

  const ui = fs.readFileSync('components/ui.tsx', 'utf8');
  assert.match(ui, /export function SeenRejectNotice[\s\S]*accessibilityRole="button"/);
  assert.match(ui, />Open</);
  const home = fs.readFileSync('app/(app)/sites/index.tsx', 'utf8');
  assert.match(home, /openReplacedNotice/);
  const drawing = fs.readFileSync('app/(app)/sites/[siteId]/drawing/[drawingId].tsx', 'utf8');
  assert.match(drawing, /clearNoticesAfterOpen/);
});

test("a flush for one user drops another user's queued tap without a server call", async () => {
  const queue = memoryDrawingSeenQueue();
  assert.equal(
    await queueSeenTap(queue, {
      ownerId: OWNER_A,
      drawingId: 'd1',
      siteId: 's1',
      revision: 'B',
      at: '2026-10-22T10:00:00.000Z',
      opened: true,
    }),
    'queued'
  );
  const calls: string[] = [];
  await flushDrawingSeenQueue(
    queue,
    {
      async recordOpen(drawingId) {
        calls.push(`open:${drawingId}`);
      },
      async confirm(drawingId) {
        calls.push(`confirm:${drawingId}`);
      },
    },
    OWNER_B
  );
  assert.deepEqual(calls, []);
  assert.equal((await queue.list()).length, 0);
});

test('a seen notice is shown only to the person who queued it', async () => {
  const queue = memoryDrawingSeenQueue();
  await rememberRejectedTap(queue, {
    ownerId: OWNER_A,
    drawingId: 'd1',
    siteId: 's1',
    revision: 'B',
    code: 'drawing_not_found',
  });
  assert.deepEqual(noticesForOwner(await queue.listNotices(), OWNER_B), []);
  assert.equal(noticesForOwner(await queue.listNotices(), OWNER_A)[0]?.message, 'Rev B was not saved');
  const calls: string[] = [];
  await flushDrawingSeenQueue(
    queue,
    {
      async recordOpen() {
        calls.push('open');
      },
      async confirm() {
        calls.push('confirm');
      },
    },
    OWNER_B
  );
  assert.deepEqual(calls, []);
  assert.equal((await queue.listNotices()).length, 0);
  assert.deepEqual(noticesForOwner(await queue.listNotices(), OWNER_B), []);
});
