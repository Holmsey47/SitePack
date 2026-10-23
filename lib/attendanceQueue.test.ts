import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { SnagRequestError, throwSnagRpc } from '../data/snagFailure.ts';
import {
  adoptAttendanceOwner,
  ATTENDANCE_NOTICE_KEY,
  ATTENDANCE_OWNER_KEY,
  ATTENDANCE_QUEUE_KEY,
  flushAttendanceQueue,
  isRetryableAttendanceFailure,
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

test('a retryable sign-in holds the sign-out for that shift and another shift still sends', async () => {
  const queue = memoryAttendanceQueue();
  const signIn = tap('user-a');
  const signOut: QueuedTap = { ...tap('user-a', 'out'), localId: 'user-a-out', deviceAt: '2026-10-22T08:05:00.000Z' };
  const other: QueuedTap = { ...tap('user-a', 'out'), localId: 'other-site', siteId: 'site-b', deviceAt: '2026-10-22T08:06:00.000Z' };
  await queue.put(signIn);
  await queue.put(signOut);
  await queue.put(other);
  const sent: string[] = [];
  await flushAttendanceQueue(queue, 'user-a', async (item) => {
    if (item.localId === signIn.localId) throw new TypeError('Failed to fetch');
    sent.push(item.localId);
  });
  assert.deepEqual(sent, ['other-site']);
  const left = await queue.list();
  assert.deepEqual(left.map((item) => item.localId).sort(), ['user-a-in', 'user-a-out']);
  assert.equal((left.find((item) => item.localId === 'user-a-in')?.attempts ?? 0) > 0, true);
  let calls = 0;
  await flushAttendanceQueue(queue, 'user-a', async () => {
    calls += 1;
  });
  assert.equal(calls, 0);
  assert.equal((await queue.list()).length, 2);
});

test('a sign-out is not sent while an earlier tap for that shift is still queued', async () => {
  const queue = memoryAttendanceQueue();
  const signIn = tap('user-a');
  await persistThenSendAttendance(signIn, true, async () => {
    throw new TypeError('Network request failed');
  }, queue);
  let calls = 0;
  const signOut: QueuedTap = { ...tap('user-a', 'out'), localId: 'user-a-out', deviceAt: '2026-10-22T08:05:00.000Z' };
  const result = await persistThenSendAttendance(signOut, true, async () => {
    calls += 1;
  }, queue);
  assert.equal(result, 'queued');
  assert.equal(calls, 0);
  const sent: string[] = [];
  await flushAttendanceQueue(queue, 'user-a', async (item) => {
    sent.push(item.action);
  });
  assert.deepEqual(sent, []);
});

test('network and timeout retry; a known business code does not', async () => {
  const retryable = [new TypeError('Failed to fetch'), new TypeError('Network request failed'), new Error('timeout')];
  for (const err of retryable) {
    assert.equal(isRetryableAttendanceFailure(err), true, err.message);
    const queue = memoryAttendanceQueue();
    const result = await persistThenSendAttendance({ ...tap('user-a'), localId: `retry-${retryable.indexOf(err)}` }, true, async () => {
      throw err;
    }, queue);
    assert.equal(result, 'queued');
    assert.equal((await queue.list()).length, 1);
  }

  const named = new SnagRequestError({ kind: 'business', code: 'already_signed_in', detail: 'Plot 12 – Oak Estate' });
  assert.equal(isRetryableAttendanceFailure(named), false);
  assert.equal(isRetryableAttendanceFailure(new Error('not_signed_in')), false);
  const queue = memoryAttendanceQueue();
  const refused = await persistThenSendAttendance(tap('user-a'), true, async () => {
    throw named;
  }, queue);
  assert.equal(refused, 'refused');
  assert.equal((await queue.list()).length, 0);
  assert.match((await queue.listNotices())[0]?.message ?? '', /Plot 12 – Oak Estate/);
});

test('a real supabase client keeps response status: 503 and 502 stay queued, 400 and 401 are a notice', async () => {
  const siteId = '51111111-1111-4111-8111-111111111111';
  const deviceAt = '2026-10-20T06:00:00.000Z';
  const cases = [
    {
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'PGRST002',
        details: null,
        hint: null,
        message: 'Could not query the database for the schema cache. Retrying.',
      }),
      queued: true,
    },
    { status: 503, contentType: 'text/plain', body: 'no available server', queued: true },
    {
      status: 502,
      contentType: 'text/html',
      body: '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>',
      queued: true,
    },
    { status: 408, contentType: 'text/plain', body: 'retry later', queued: true },
    {
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST000', details: null, hint: null, message: 'Too many requests' }),
      queued: true,
    },
    {
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST102', details: null, hint: null, message: 'Empty or invalid json' }),
      queued: false,
    },
    {
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST301', details: null, hint: null, message: 'JWT expired' }),
      queued: false,
    },
  ];

  for (const item of cases) {
    const client = createClient('http://127.0.0.1:54321', 'test-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async () => new Response(item.body, { status: item.status, headers: { 'content-type': item.contentType } }),
      },
    });
    const args = { p_site_id: siteId, p_device_at: deviceAt };
    const response = await client.rpc('sign_in_site', args);
    assert.equal(response.status, item.status);
    assert.equal(response.error == null || !('status' in response.error), true);
    let thrown: unknown;
    try {
      throwSnagRpc(response);
      assert.fail(`${item.status} ${item.contentType} should fail`);
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof SnagRequestError, `${item.status} ${item.contentType}`);
    assert.equal(thrown.failure.kind, 'http', `${item.status} ${item.contentType}`);
    assert.equal(thrown.failure.kind === 'http' ? thrown.failure.status : 0, item.status);
    const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
    assert.match(repo, /signInSite\(siteId, deviceAt\) \{[\s\S]*?throwSnagRpc</);
    assert.match(repo, /signOutSite\(siteId, deviceAt\) \{[\s\S]*?throwSnagRpc</);
    assert.match(repo, /snagRpcError\(response\.error, response\.status\)/);

    const queue = memoryAttendanceQueue();
    const result = await persistThenSendAttendance(
      { ...tap('user-a'), localId: `http-${item.status}-${item.contentType}` },
      true,
      async () => {
        throwSnagRpc(await client.rpc('sign_in_site', args));
      },
      queue
    );
    if (item.queued) {
      assert.equal(result, 'queued', `${item.status} ${item.contentType}`);
      assert.equal((await queue.list()).length, 1);
      assert.equal((await queue.listNotices()).length, 0);
    } else {
      assert.equal(result, 'refused', `${item.status} ${item.contentType}`);
      assert.equal((await queue.list()).length, 0);
      assert.equal((await queue.listNotices()).length, 1);
    }
  }
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
