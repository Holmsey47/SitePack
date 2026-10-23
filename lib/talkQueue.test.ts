import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { SnagRequestError, isRetryableSnagFailure, throwSnagRpc } from '@/data/snagFailure';
import {
  adoptTalkOwner,
  classifyTalkFailure,
  flushTalkQueue,
  keptTalkMessage,
  memoryTalkQueue,
  noticesForUser,
  pendingTalksForUser,
  persistThenSendTalk,
  rememberRefusedTalk,
  refusedTalkNotice,
  SIGN_IN_AGAIN,
  storageTalkQueue,
  talkBackoffMs,
  TALK_BACKOFF_MAX_MS,
  TALK_NOTICE_KEY,
  TALK_OWNER_KEY,
  TALK_QUEUE_KEY,
  wipeTalkQueue,
  type QueuedTalk,
} from './talkQueue.ts';

function item(userId: string, signerPersonId = userId): QueuedTalk {
  return {
    localId: `${userId}-${signerPersonId}`,
    userId,
    siteId: 'site-a',
    talkId: 'talk-1',
    versionId: 'version-1',
    signerPersonId,
    action: 'sign',
    signaturePng: null,
    question: null,
    explainedVerbally: false,
    interpreterUsed: false,
    deviceAt: '2026-10-22T07:55:00.000Z',
    sessionId: 'session-abc-1',
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

test('a queued signature keeps the device time and sends that time', async () => {
  const queue = memoryTalkQueue();
  const seen: string[] = [];
  const offline = await persistThenSendTalk(item('user-a'), false, async () => {
    throw new Error('should not send');
  }, queue);
  assert.equal(offline, 'queued');
  assert.equal((await queue.list())[0]?.deviceAt, '2026-10-22T07:55:00.000Z');
  await flushTalkQueue(queue, 'user-a', async (queued) => {
    seen.push(queued.deviceAt);
  });
  assert.deepEqual(seen, ['2026-10-22T07:55:00.000Z']);
  assert.equal((await queue.list()).length, 0);
});

test('A queues, the wipe runs, and B flush makes zero calls', async () => {
  const box = storage();
  const queue = storageTalkQueue(box);
  await queue.put(item('user-a'));
  assert.equal(box.getItem(TALK_QUEUE_KEY)?.includes('user-a'), true);
  await wipeTalkQueue(queue);
  assert.equal(box.getItem(TALK_QUEUE_KEY), null);
  assert.equal(box.getItem(TALK_NOTICE_KEY), null);
  assert.equal(box.getItem(TALK_OWNER_KEY), null);
  let calls = 0;
  await flushTalkQueue(queue, 'user-b', async () => {
    calls += 1;
  });
  assert.equal(calls, 0);
});

test('a flush drops another login with zero network calls', async () => {
  const queue = memoryTalkQueue();
  await queue.put(item('user-a'));
  await queue.put(item('user-b'));
  let calls = 0;
  await flushTalkQueue(queue, 'user-b', async (queued) => {
    calls += 1;
    assert.equal(queued.userId, 'user-b');
  });
  assert.equal(calls, 1);
  assert.equal((await queue.list()).length, 0);
});

test('a shared-device capture is owned by the logged-in user and carries the signer', async () => {
  const queue = memoryTalkQueue();
  const shared = item('manager-auth', 'lad-person');
  await queue.put(shared);
  let ladCalls = 0;
  await flushTalkQueue(queue, 'lad-auth', async () => {
    ladCalls += 1;
  });
  assert.equal(ladCalls, 0);
  assert.equal((await queue.list()).length, 0);

  await queue.put(shared);
  const seen: string[] = [];
  await flushTalkQueue(queue, 'manager-auth', async (queued) => {
    seen.push(queued.signerPersonId);
    assert.equal(queued.userId, 'manager-auth');
  });
  assert.deepEqual(seen, ['lad-person']);
});

test('an owner change wipes the previous queue before the next flush', async () => {
  const box = storage();
  const queue = storageTalkQueue(box);
  box.setItem(TALK_OWNER_KEY, 'user-a');
  await queue.put(item('user-a', 'other-person'));
  await adoptTalkOwner('user-b', queue, box);
  assert.equal(box.getItem(TALK_OWNER_KEY), 'user-b');
  assert.equal((await queue.list()).length, 0);
  let calls = 0;
  await flushTalkQueue(queue, 'user-b', async () => {
    calls += 1;
  });
  assert.equal(calls, 0);
  await queue.put(item('user-b'));
  await adoptTalkOwner('user-b', queue, box);
  assert.equal((await queue.list()).length, 1);
});

test('a refused queued signature is dropped and leaves an in-app notice', async () => {
  const queue = memoryTalkQueue();
  const result = await persistThenSendTalk(item('user-a'), true, async () => {
    throw new Error('not_authorized');
  }, queue);
  assert.equal(result, 'refused');
  assert.equal((await queue.list()).length, 0);
  const notices = await queue.listNotices();
  assert.equal(notices[0]?.message, refusedTalkNotice('sign', 'not_authorized'));
  assert.match(notices[0]?.message ?? '', /not saved/);
  assert.match(notices[0]?.message ?? '', /Ask the site manager/);
});

function queued(localId: string, signer: string, talkId: string, deviceAt: string): QueuedTalk {
  return {
    ...item('user-a', signer),
    localId,
    talkId,
    deviceAt,
  };
}

test('a network failure stays queued with backoff and does not block another signer', async () => {
  const queue = memoryTalkQueue();
  const now = Date.parse('2026-10-23T00:00:00.000Z');
  await queue.put(queued('a', 'signer-1', 'talk-1', '2026-10-22T07:00:00.000Z'));
  await queue.put(queued('c', 'signer-1', 'talk-1', '2026-10-22T07:05:00.000Z'));
  await queue.put(queued('b', 'signer-2', 'talk-1', '2026-10-22T07:02:00.000Z'));
  const calls: string[] = [];
  await flushTalkQueue(
    queue,
    'user-a',
    async (row) => {
      calls.push(row.localId);
      if (row.localId === 'a') throw new TypeError('Failed to fetch');
    },
    now
  );
  assert.deepEqual(calls, ['a', 'b']);
  const left = await queue.list();
  assert.deepEqual(left.map((row) => row.localId).sort(), ['a', 'c']);
  const held = left.find((row) => row.localId === 'a');
  assert.equal(held?.attempts, 1);
  assert.equal(Date.parse(held?.nextAttemptAt ?? '') - now, talkBackoffMs(1));
  const notices = await queue.listNotices();
  assert.equal(notices.find((row) => row.retryLocalId === 'a')?.message, keptTalkMessage('sign'));
  const duringBackoff: string[] = [];
  await flushTalkQueue(queue, 'user-a', async (row) => {
    duringBackoff.push(row.localId);
  }, now + 500);
  assert.deepEqual(duringBackoff, []);
  const afterBackoff: string[] = [];
  await flushTalkQueue(queue, 'user-a', async (row) => {
    afterBackoff.push(row.localId);
  }, now + talkBackoffMs(1));
  assert.deepEqual(afterBackoff, ['a', 'c']);
});

test('a phone network error, a 503, and an unknown storage error each take their own path', async () => {
  const queue = memoryTalkQueue();
  const network = new TypeError('Network request failed');
  const storage = new Error('unknown');
  assert.equal(classifyTalkFailure(network).kind, 'network');
  assert.equal(classifyTalkFailure(storage).kind, 'network');
  const httpFailures = await postgrestFailures();
  await queue.put(queued('net', 'signer-1', 'talk-1', '2026-10-22T07:00:00.000Z'));
  await queue.put(queued('pgrst', 'signer-2', 'talk-1', '2026-10-22T07:01:00.000Z'));
  await queue.put(queued('plain', 'signer-3', 'talk-1', '2026-10-22T07:02:00.000Z'));
  await queue.put(queued('html', 'signer-4', 'talk-1', '2026-10-22T07:03:00.000Z'));
  await queue.put(queued('empty', 'signer-5', 'talk-1', '2026-10-22T07:04:00.000Z'));
  await queue.put(queued('storage', 'signer-6', 'talk-1', '2026-10-22T07:05:00.000Z'));
  await queue.put(queued('bad', 'signer-7', 'talk-1', '2026-10-22T07:06:00.000Z'));
  await queue.put(queued('unauth', 'signer-8', 'talk-1', '2026-10-22T07:07:00.000Z'));
  await queue.put(queued('jwt', 'signer-10', 'talk-1', '2026-10-22T07:07:30.000Z'));
  await queue.put(queued('after', 'signer-9', 'talk-1', '2026-10-22T07:08:00.000Z'));
  const calls: string[] = [];
  await flushTalkQueue(queue, 'user-a', async (row) => {
    calls.push(row.localId);
    if (row.localId === 'net') throw network;
    const failure = httpFailures.get(row.localId);
    if (failure) throw failure;
    if (row.localId === 'storage') throw storage;
  });
  assert.deepEqual(calls, ['net', 'pgrst', 'plain', 'html', 'empty', 'storage', 'bad', 'unauth', 'jwt', 'after']);
  const left = (await queue.list()).map((row) => row.localId).sort();
  assert.deepEqual(left, ['empty', 'html', 'jwt', 'net', 'pgrst', 'plain', 'storage', 'unauth']);
  const notices = await queue.listNotices();
  assert.equal(notices.some((row) => row.id === 'reject:storage'), false);
  assert.equal(notices.some((row) => row.id === 'reject:bad' && row.retryLocalId === null), true);
  assert.equal(notices.some((row) => row.id === 'reject:unauth'), false);
  assert.equal(notices.some((row) => row.id === 'reject:jwt'), false);
  assert.equal(notices.find((row) => row.id === 'retry:unauth')?.message, SIGN_IN_AGAIN);
  assert.equal(notices.find((row) => row.id === 'retry:jwt')?.message, SIGN_IN_AGAIN);
  assert.equal((await queue.list()).find((row) => row.localId === 'jwt')?.needsSignIn, true);
  assert.equal(notices.find((row) => row.id === 'reject:bad')?.message, refusedTalkNotice('sign', '400'));
  assert.equal(refusedTalkNotice('sign', '400').includes('Try again'), false);
  assert.match(notices.find((row) => row.id === 'reject:bad')?.message ?? '', /not saved/);
  assert.equal(notices.filter((row) => row.retryLocalId).length, 8);
});

const PGRST002 = JSON.stringify({
  code: 'PGRST002',
  details: null,
  hint: null,
  message: 'Could not query the database for the schema cache. Retrying the connection.',
});

/** A real supabase-js client. Status comes from the response, never stuck onto the error. */
async function postgrestFailures(): Promise<Map<string, SnagRequestError>> {
  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  const queueSrc = fs.readFileSync('lib/talkQueue.ts', 'utf8');
  assert.match(repo, /return throwSnagRpc\(await getSupabase\(\)\.rpc\(name, args\)\)/);
  assert.doesNotMatch(queueSrc, /throwTalkRpc|TalkRpcError|talkFailureFromRpc/);
  const specs: Array<[string, number, string, string]> = [
    ['pgrst', 503, PGRST002, 'application/json'],
    ['plain', 503, 'upstream connect error', 'text/plain'],
    ['html', 502, '<html><body>Bad Gateway</body></html>', 'text/html'],
    ['empty', 503, '', 'text/plain'],
    ['bad', 400, JSON.stringify({ code: 'PGRST102', message: 'Empty or invalid json', details: null, hint: null }), 'application/json'],
    ['unauth', 401, JSON.stringify({ message: 'Unauthorized' }), 'application/json'],
    ['jwt', 401, JSON.stringify({ code: 'PGRST301', details: null, hint: null, message: 'JWT expired' }), 'application/json'],
  ];
  const failures = new Map<string, SnagRequestError>();
  for (const [id, status, body, contentType] of specs) {
    const fetchImpl: typeof fetch = async () => new Response(body, { status, headers: { 'content-type': contentType } });
    const client = createClient('https://example.invalid', 'sb_publishable_test', {
      global: { fetch: fetchImpl },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const response = await client.rpc('sign_site_talk', { p_talk_id: '00000000-0000-4000-8000-000000000001' });
    assert.equal(response.status, status);
    assert.ok(response.error);
    assert.equal(Object.hasOwn(response.error, 'status'), false);
    try {
      throwSnagRpc(response);
      assert.fail('rpc should throw');
    } catch (err) {
      assert.ok(err instanceof SnagRequestError);
      const classified = classifyTalkFailure(err);
      if (status >= 500) {
        assert.equal(isRetryableSnagFailure(err), true);
        assert.deepEqual(classified, { kind: 'http', status });
      } else if (status === 401) {
        assert.equal(isRetryableSnagFailure(err), true);
        assert.equal(classified.kind, 'signin');
      } else {
        assert.equal(isRetryableSnagFailure(err), false);
        assert.equal(classified.kind, 'permanent');
      }
      failures.set(id, err);
    }
  }
  return failures;
}

test('a duplicate signature is already saved, and an expired session wipes the queue', async () => {
  const queue = memoryTalkQueue();
  const duplicate = Object.assign(new Error('duplicate key value violates unique constraint "site_talk_signatures_version_id_person_id_signature_role_key"'), {
    code: '23505',
  });
  await queue.put(queued('dup', 'signer-1', 'talk-1', '2026-10-22T07:00:00.000Z'));
  await queue.put(queued('next', 'signer-2', 'talk-1', '2026-10-22T07:01:00.000Z'));
  const calls: string[] = [];
  await flushTalkQueue(queue, 'user-a', async (row) => {
    calls.push(row.localId);
    if (row.localId === 'dup') throw duplicate;
  });
  assert.deepEqual(calls, ['dup', 'next']);
  assert.equal((await queue.list()).length, 0);
  assert.equal((await queue.listNotices()).some((row) => row.id === 'reject:dup'), false);

  const duplicateBody = JSON.stringify({
    code: '23505',
    details: null,
    hint: null,
    message: 'duplicate key value violates unique constraint "site_talk_signatures_version_id_person_id_signature_role_key"',
  });
  const client = createClient('https://example.invalid', 'sb_publishable_test', {
    global: {
      fetch: async () => new Response(duplicateBody, { status: 409, headers: { 'content-type': 'application/json' } }),
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const response = await client.rpc('sign_site_talk', { p_talk_id: '00000000-0000-4000-8000-000000000001' });
  assert.equal(response.status, 409);
  assert.equal(Object.hasOwn(response.error ?? {}, 'status'), false);
  let thrown: unknown;
  try {
    throwSnagRpc(response);
  } catch (err) {
    thrown = err;
  }
  assert.equal(classifyTalkFailure(thrown).kind, 'duplicate');
  await queue.put(queued('dup-http', 'signer-3', 'talk-1', '2026-10-22T07:01:30.000Z'));
  await queue.put(queued('after-dup', 'signer-4', 'talk-2', '2026-10-22T07:01:40.000Z'));
  const httpCalls: string[] = [];
  await flushTalkQueue(queue, 'user-a', async (row) => {
    httpCalls.push(row.localId);
    if (row.localId === 'dup-http') throw thrown;
  });
  assert.deepEqual(httpCalls, ['dup-http', 'after-dup']);
  assert.equal((await queue.list()).length, 0);
  assert.equal((await queue.listNotices()).some((row) => row.id === 'reject:dup-http'), false);

  await queue.put(queued('old', 'signer-1', 'talk-1', '2026-10-22T07:00:00.000Z'));
  await queue.put(queued('later', 'signer-2', 'talk-9', '2026-10-22T07:02:00.000Z'));
  const expired: string[] = [];
  await flushTalkQueue(queue, 'user-a', async (row) => {
    expired.push(row.localId);
    if (row.localId === 'old') throw new Error('JWT expired');
  });
  assert.deepEqual(expired, ['old']);
  assert.equal((await queue.list()).length, 0);
  assert.equal((await queue.listNotices()).length, 0);
});

test('a new version tells the person to read and sign again', async () => {
  const queue = memoryTalkQueue();
  const result = await persistThenSendTalk(item('user-a'), true, async () => {
    throw new Error('version_locked');
  }, queue);
  assert.equal(result, 'refused');
  assert.match((await queue.listNotices())[0]?.message ?? '', /Read it and sign again/);
});

test('sign-out, owner change, and a rejected session wipe the talk queue', () => {
  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  const bind = auth.slice(auth.indexOf('async function bindCache'), auth.indexOf('function authTokenKey'));
  assert.match(bind, /if \(userId\) \{\s*try \{\s*await adoptTalkOwner\(userId\)/);
  assert.doesNotMatch(bind, /adoptAttendanceOwner\(userId\);\s*await adoptTalkOwner/);
  assert.match(bind, /else \{[\s\S]*wipeAttendanceQueue\(\)/);
  assert.match(bind, /if \(!userId\) \{\s*try \{\s*await wipeTalkQueue\(\)/);
  assert.doesNotMatch(bind, /wipeAttendanceQueue\(\);\s*await wipeTalkQueue\(\)/);
  assert.match(auth, /signOut: async \(\) => \{[\s\S]*bindCache\(null\)/);
  assert.match(auth, /if \(decision\.wipe \|\| !decision\.userId\) \{[\s\S]*bindCache\(null\)/);
  const sync = fs.readFileSync('lib/talkSync.ts', 'utf8');
  assert.match(sync, /isFixtureOffline\(\) && \(await deviceIsOnline\(\)\)/);
  assert.match(sync, /if \(online\) await flushTalkQueue/);
  assert.match(sync, /noticesForUser\(await queue\.listNotices\(\), userId\)/);
  assert.match(sync, /pendingTalksForUser\(await queue\.list\(\), userId\)/);
});

test('a 401 stays queued for this user, and a different login still wipes it', async () => {
  const queue = memoryTalkQueue();
  const kept = storage();
  await adoptTalkOwner('user-a', queue, kept);
  const result = await persistThenSendTalk(item('user-a'), true, async () => {
    throw Object.assign(new Error('JWT expired'), { status: 401 });
  }, queue);
  assert.equal(result, 'queued');
  assert.equal(SIGN_IN_AGAIN, 'Sign in again to send what is saved on this phone');
  const saved = (await queue.list())[0];
  assert.equal(saved?.needsSignIn, true);
  assert.equal(saved?.userId, 'user-a');
  assert.equal((await queue.listNotices())[0]?.message, SIGN_IN_AGAIN);
  await adoptTalkOwner('user-a', queue, kept);
  assert.equal((await queue.list()).length, 1);
  await adoptTalkOwner('user-b', queue, kept);
  assert.equal((await queue.list()).length, 0);
  assert.equal((await queue.listNotices()).length, 0);
});

test('network and unknown-error backoff stops at 5 minutes', async () => {
  assert.equal(talkBackoffMs(1), 1000);
  assert.equal(talkBackoffMs(20), TALK_BACKOFF_MAX_MS);
  assert.equal(talkBackoffMs(100), TALK_BACKOFF_MAX_MS);
  const queue = memoryTalkQueue();
  const before = Date.now();
  const result = await persistThenSendTalk({ ...item('user-a'), attempts: 40 }, true, async () => {
    throw new Error('boom-not-a-code');
  }, queue);
  assert.equal(result, 'queued');
  assert.equal(classifyTalkFailure(new Error('boom-not-a-code')).kind, 'network');
  assert.equal(classifyTalkFailure(new Error('unknown')).kind, 'network');
  const retryAt = Date.parse((await queue.list())[0]?.nextAttemptAt ?? '');
  assert.ok(retryAt - before <= TALK_BACKOFF_MAX_MS + 1000);
  assert.ok(retryAt - before >= TALK_BACKOFF_MAX_MS - 1000);
});

test('a wipe removes notices as well as queued signatures', async () => {
  const box = storage();
  const queue = storageTalkQueue(box);
  await queue.put(item('user-a'));
  await queue.putNotice({
    id: 'reject:kept',
    userId: 'user-a',
    siteId: 'site-a',
    talkId: 'talk-1',
    message: 'Kept by mistake',
    retryLocalId: null,
  });
  box.setItem(TALK_OWNER_KEY, 'user-a');
  await wipeTalkQueue(queue);
  assert.equal(box.getItem(TALK_QUEUE_KEY), null);
  assert.equal(box.getItem(TALK_NOTICE_KEY), null);
  assert.equal((await queue.list()).length, 0);
  assert.equal((await queue.listNotices()).length, 0);
});

test('notice and pending filters keep this user and drop a missing or different one', () => {
  const queued = [item('user-a'), { ...item('user-b'), localId: 'b' }];
  const notes = [
    { id: 'a', userId: 'user-a', siteId: 'site-a', talkId: 'talk-1', message: 'A', retryLocalId: null },
    { id: 'b', userId: 'user-b', siteId: 'site-a', talkId: 'talk-1', message: 'B', retryLocalId: null },
  ];
  assert.deepEqual(pendingTalksForUser(queued, 'user-a').map((row) => row.userId), ['user-a']);
  assert.deepEqual(pendingTalksForUser(queued, 'user-b').map((row) => row.localId), ['b']);
  assert.deepEqual(pendingTalksForUser(queued, ''), []);
  assert.deepEqual(pendingTalksForUser(queued, null), []);
  assert.deepEqual(pendingTalksForUser(queued, undefined), []);
  assert.deepEqual(noticesForUser(notes, 'user-a').map((row) => row.id), ['a']);
  assert.deepEqual(noticesForUser(notes, 'user-b').map((row) => row.id), ['b']);
  assert.deepEqual(noticesForUser(notes, ''), []);
  assert.deepEqual(noticesForUser([{ ...notes[0]!, userId: '' }], ''), []);
});

test('a refused notice belongs to that signature and keeps its own id', async () => {
  const queue = memoryTalkQueue();
  const first = await rememberRefusedTalk(queue, { ...item('user-b'), localId: 'one' }, 'not_authorized');
  const second = await rememberRefusedTalk(queue, { ...item('user-a'), localId: 'two' }, 'version_locked');
  assert.equal(first.userId, 'user-b');
  assert.equal(first.id, 'reject:one');
  assert.equal(second.userId, 'user-a');
  assert.equal(second.id, 'reject:two');
  const notices = await queue.listNotices();
  assert.equal(notices.length, 2);
  assert.equal(new Set(notices.map((notice) => notice.id)).size, 2);
  assert.notEqual(notices[0]?.id, 'reject');
});

test('a refused signature is removed so a later flush does not send it again', async () => {
  const queue = memoryTalkQueue();
  let calls = 0;
  const result = await persistThenSendTalk(item('user-a'), true, async () => {
    calls += 1;
    throw new Error('version_locked');
  }, queue);
  assert.equal(result, 'refused');
  assert.equal((await queue.list()).length, 0);
  assert.equal((await queue.listNotices()).length, 1);
  await flushTalkQueue(queue, 'user-a', async () => {
    calls += 1;
  });
  assert.equal(calls, 1);
  assert.equal((await queue.listNotices()).length, 1);
});
