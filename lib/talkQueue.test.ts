import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  adoptTalkOwner,
  flushTalkQueue,
  memoryTalkQueue,
  persistThenSendTalk,
  refusedTalkNotice,
  storageTalkQueue,
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
  assert.equal(notices[0]?.message, refusedTalkNotice('sign'));
  assert.match(notices[0]?.message ?? '', /not saved/);
});

test('sign-out, owner change, and a rejected session wipe the talk queue', () => {
  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  const bind = auth.slice(auth.indexOf('async function bindCache'), auth.indexOf('function authTokenKey'));
  assert.match(bind, /if \(userId\) \{[\s\S]*adoptTalkOwner\(userId\)/);
  assert.match(bind, /else \{[\s\S]*wipeTalkQueue\(\)/);
  assert.match(auth, /signOut: async \(\) => \{[\s\S]*bindCache\(null\)/);
  assert.match(auth, /if \(decision\.wipe \|\| !decision\.userId\) \{[\s\S]*bindCache\(null\)/);
  const sync = fs.readFileSync('lib/talkSync.ts', 'utf8');
  assert.match(sync, /isFixtureOffline\(\) && \(await deviceIsOnline\(\)\)/);
  assert.match(sync, /if \(online\) await flushTalkQueue/);
});
