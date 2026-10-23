import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  adoptAttendanceOwner,
  ATTENDANCE_NOTICE_KEY,
  ATTENDANCE_OWNER_KEY,
  ATTENDANCE_QUEUE_KEY,
  flushAttendanceQueue,
  memoryAttendanceQueue,
  persistThenSendAttendance,
  refusedTapNotice,
  storageAttendanceQueue,
  wipeAttendanceQueue,
  type QueuedTap,
} from './attendanceQueue.ts';

function tap(userId: string, action: QueuedTap['action'] = 'in'): QueuedTap {
  return {
    localId: `${userId}-${action}`,
    userId,
    siteId: 'site-a',
    action,
    deviceAt: '2026-10-22T07:55:00.000Z',
  };
}

function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

test('a queued tap keeps the device time and sends that time', async () => {
  const queue = memoryAttendanceQueue();
  const seen: string[] = [];
  const item = tap('user-a');
  const offline = await persistThenSendAttendance(item, false, async () => {
    throw new Error('should not send');
  }, queue);
  assert.equal(offline, 'queued');
  assert.equal((await queue.list())[0]?.deviceAt, '2026-10-22T07:55:00.000Z');
  await flushAttendanceQueue(queue, 'user-a', async (queued) => {
    seen.push(queued.deviceAt);
  });
  assert.deepEqual(seen, ['2026-10-22T07:55:00.000Z']);
  assert.equal((await queue.list()).length, 0);
});

test('A queues, the wipe runs, and B flush makes zero calls', async () => {
  const box = storage();
  const queue = storageAttendanceQueue(box);
  await queue.put(tap('user-a'));
  assert.equal(box.getItem(ATTENDANCE_QUEUE_KEY)?.includes('user-a'), true);
  await wipeAttendanceQueue(queue);
  assert.equal(box.getItem(ATTENDANCE_QUEUE_KEY), null);
  assert.equal(box.getItem(ATTENDANCE_NOTICE_KEY), null);
  assert.equal(box.getItem(ATTENDANCE_OWNER_KEY), null);
  let calls = 0;
  await flushAttendanceQueue(queue, 'user-b', async () => {
    calls += 1;
  });
  assert.equal(calls, 0);
});

test('a flush drops another login with zero network calls', async () => {
  const queue = memoryAttendanceQueue();
  await queue.put(tap('user-a'));
  await queue.put(tap('user-b', 'out'));
  let calls = 0;
  await flushAttendanceQueue(queue, 'user-b', async (item) => {
    calls += 1;
    assert.equal(item.userId, 'user-b');
  });
  assert.equal(calls, 1);
  assert.equal((await queue.list()).length, 0);
});

test('an owner change wipes the previous queue before the next flush', async () => {
  const box = storage();
  const queue = storageAttendanceQueue(box);
  box.setItem(ATTENDANCE_OWNER_KEY, 'user-a');
  await queue.put(tap('user-a'));
  await adoptAttendanceOwner('user-b', queue, box);
  assert.equal(box.getItem(ATTENDANCE_OWNER_KEY), 'user-b');
  assert.equal((await queue.list()).length, 0);
  let calls = 0;
  await flushAttendanceQueue(queue, 'user-b', async () => {
    calls += 1;
  });
  assert.equal(calls, 0);
  await queue.put(tap('user-b'));
  await adoptAttendanceOwner('user-b', queue, box);
  assert.equal((await queue.list()).length, 1);
});

test('a refused queued tap is dropped and leaves an in-app notice', async () => {
  const queue = memoryAttendanceQueue();
  const result = await persistThenSendAttendance(tap('user-a', 'out'), true, async () => {
    throw new Error('not_signed_in');
  }, queue);
  assert.equal(result, 'refused');
  assert.equal((await queue.list()).length, 0);
  const notices = await queue.listNotices();
  assert.equal(notices[0]?.message, refusedTapNotice('out', 'not_signed_in'));
  assert.match(notices[0]?.message ?? '', /not saved/);
});

test('an unexpected error backs off, moves on, and keeps the tap', async () => {
  const queue = memoryAttendanceQueue();
  const first = tap('user-a');
  const second: QueuedTap = { ...tap('user-a', 'out'), localId: 'user-a-later', deviceAt: '2026-10-22T08:05:00.000Z' };
  await queue.put(first);
  await queue.put(second);
  const sent: string[] = [];
  await flushAttendanceQueue(queue, 'user-a', async (item) => {
    if (item.localId === first.localId) throw new Error('timeout');
    sent.push(item.localId);
  });
  assert.deepEqual(sent, ['user-a-later']);
  const left = await queue.list();
  assert.equal(left.length, 1);
  assert.equal(left[0]?.localId, first.localId);
  assert.equal((left[0]?.attempts ?? 0) > 0, true);
  assert.equal(Number.isNaN(Date.parse(left[0]?.retryAt ?? '')), false);
  let calls = 0;
  await flushAttendanceQueue(queue, 'user-a', async () => {
    calls += 1;
  });
  assert.equal(calls, 0);
});

test('a notice can be dismissed', async () => {
  const queue = memoryAttendanceQueue();
  await queue.putNotice({ id: 'n1', userId: 'user-a', siteId: 'site-a', message: 'Saved notice' });
  await queue.dismissNotice('n1');
  assert.equal((await queue.listNotices()).length, 0);
});

test('sign-out, owner change, and a rejected session wipe the attendance keys', () => {
  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  const bind = auth.slice(auth.indexOf('async function bindCache'), auth.indexOf('function authTokenKey'));
  assert.match(bind, /if \(userId\) \{[\s\S]*adoptAttendanceOwner\(userId\)/);
  assert.match(bind, /else \{[\s\S]*wipeAttendanceQueue\(\)/);
  assert.match(auth, /signOut: async \(\) => \{[\s\S]*bindCache\(null\)/);
  assert.match(auth, /if \(decision\.wipe \|\| !decision\.userId\) \{[\s\S]*bindCache\(null\)/);
});
