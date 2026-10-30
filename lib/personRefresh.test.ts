import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { Person } from '../data/types.ts';
import { createReconnectSync } from './offlineFlush.ts';
import {
  loadPersonKeepingCurrent,
  personAfterRefresh,
  personFromAuthReads,
  personOnAuthEvent,
  readGetUser,
  readMyPerson,
} from './personRefresh.ts';
import { coldStartCache, userCheckOutcome } from './sessionBoot.ts';

const member: Person = {
  id: 'person-1',
  auth_user_id: 'user-1',
  company_id: 'company-1',
  role: 'operative',
  trade: null,
  display_name: 'Amy',
  email: 'amy@sitepack.test',
  phone: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

const fetchError = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' };
const nativeFetchError = { name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' };

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('boot keeps a stored session when getUser fails with a fetch error', () => {
  assert.equal(userCheckOutcome({ name: 'AuthRetryableFetchError', status: 0 }, false), 'offline');
  assert.equal(coldStartCache('user-1', 'offline').wipe, false);
  assert.equal(readGetUser({ userId: null, error: fetchError }), 'network');
  assert.equal(readGetUser({ userId: null, error: nativeFetchError }), 'network');
});

test('an offline refresh keeps the person when getUser returns a fetch error', async () => {
  await assert.rejects(
    () => personFromAuthReads({ userId: null, userError: fetchError, loadPerson: async () => member }),
    /Failed to fetch/
  );
  const loaded = await loadPersonKeepingCurrent(() =>
    personFromAuthReads({ userId: null, userError: fetchError, loadPerson: async () => null })
  );
  assert.equal(loaded.kind, 'network');
  assert.equal(personAfterRefresh(member, loaded), member);

  const native = await loadPersonKeepingCurrent(() =>
    personFromAuthReads({ userId: null, userError: nativeFetchError, loadPerson: async () => null })
  );
  assert.equal(personAfterRefresh(member, native)?.auth_user_id, 'user-1');
});

test('an offline refresh keeps the person when my_person throws a fetch error', async () => {
  assert.throws(() => readMyPerson(null, { message: 'TypeError: Failed to fetch' }), /Failed to fetch/);
  const loaded = await loadPersonKeepingCurrent(() =>
    personFromAuthReads({
      userId: 'user-1',
      userError: null,
      loadPerson: async () => readMyPerson<Person>(null, { message: 'TypeError: Failed to fetch', name: 'TypeError' }),
    })
  );
  assert.equal(loaded.kind, 'network');
  assert.equal(personAfterRefresh(member, loaded), member);
  assert.throws(() => readMyPerson(null, { message: 'Network request failed' }), /Network request failed/);
});

test('a real signed-out answer still clears the person', async () => {
  assert.equal(
    readGetUser({
      userId: null,
      error: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' },
    }),
    'signed-out'
  );
  assert.equal(
    readGetUser({ userId: null, error: { name: 'AuthApiError', status: 401, code: 'bad_jwt', message: 'invalid JWT' } }),
    'signed-out'
  );
  assert.equal(readGetUser({ userId: null, error: null }), 'signed-out');
  const missing = await personFromAuthReads({
    userId: null,
    userError: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' },
    loadPerson: async () => member,
  });
  assert.equal(missing, null);
  const loaded = await loadPersonKeepingCurrent(async () => missing);
  assert.equal(personAfterRefresh(member, loaded), null);
  assert.equal(
    personOnAuthEvent({
      event: 'SIGNED_OUT',
      sessionUserId: null,
      storedUserId: null,
      online: 'rejected',
      current: member,
      restored: member,
    }),
    null
  );
});

test('a signed-out event during a network failure keeps the person', () => {
  const kept = personOnAuthEvent({
    event: 'SIGNED_OUT',
    sessionUserId: null,
    storedUserId: 'user-1',
    online: 'offline',
    current: member,
    restored: null,
  });
  assert.equal(kept, member);
  assert.equal(
    personOnAuthEvent({
      event: 'TOKEN_REFRESHED',
      sessionUserId: 'user-1',
      storedUserId: 'user-1',
      online: 'offline',
      current: member,
      restored: null,
    }),
    member
  );
});

test('coming back online refreshes the person and flushes their queue', async () => {
  const offline = await loadPersonKeepingCurrent(async () => {
    throw new TypeError('Failed to fetch');
  });
  const kept = personAfterRefresh(member, offline);
  assert.equal(kept?.auth_user_id, 'user-1');

  const refreshed: Person = { ...member, role: 'cm', display_name: 'Amy Keane' };
  const online = await loadPersonKeepingCurrent(async () => refreshed);
  const next = personAfterRefresh(kept, online);
  assert.equal(next?.role, 'cm');
  assert.equal(next?.display_name, 'Amy Keane');

  const flushed: string[] = [];
  const sync = createReconnectSync({
    ownerId: () => next?.auth_user_id ?? null,
    flush: async (ownerId) => {
      flushed.push(ownerId);
      return { pending: false };
    },
    schedule: () => () => undefined,
  });
  sync.onOnline();
  await tick();
  assert.deepEqual(flushed, ['user-1']);
  sync.stop();
});

test('refresh, boot, and reconnect all go through the keep-on-network path', () => {
  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  assert.match(auth, /loadPersonKeepingCurrent\(\(\) => repo\.me\(\)\)/);
  assert.match(auth, /personAfterRefresh/);
  assert.match(auth, /personOnAuthEvent/);
  assert.match(auth, /AppState\.addEventListener\('change'/);
  assert.match(auth, /next === 'active'/);
  assert.match(auth, /subscribeDeviceOnline/);
  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  assert.match(repo, /personFromAuthReads/);
  assert.match(repo, /readMyPerson/);
  assert.doesNotMatch(repo, /const \{ data: userData \} = await supabase\.auth\.getUser\(\)/);
});
