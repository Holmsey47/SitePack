import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthStorage } from './secureChunks.ts';
import { performSignOut, removeAuthSessionKeys, SIGN_IN_HREF, userIdAfterAuthEvent } from './signOut.ts';

function memoryStorage(values: Map<string, string>): AuthStorage {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

test('sign-out clears the stored session and routes to sign-in when the network call fails', async () => {
  const values = new Map<string, string>([
    ['sb-proj-auth-token', '{"access_token":"a","refresh_token":"r","user":{"id":"user-1"}}'],
    ['sb-proj-auth-token-user', '{"user":{"id":"user-1"}}'],
    ['sb-proj-auth-token-code-verifier', 'verifier'],
  ]);
  const cache = { sites: 'oak', person: 'ada' };
  const order: string[] = [];
  const href = await performSignOut({
    signOutLocal: async () => {
      order.push('signOut');
      throw new Error('Failed to fetch');
    },
    clearStoredSession: async () => {
      order.push('session');
      await removeAuthSessionKeys(memoryStorage(values), 'sb-proj-auth-token');
    },
    clearAppCache: async () => {
      order.push('cache');
      cache.sites = '';
      cache.person = '';
    },
  });
  assert.deepEqual(order, ['signOut', 'session', 'cache']);
  assert.equal(values.has('sb-proj-auth-token'), false);
  assert.equal(values.has('sb-proj-auth-token-user'), false);
  assert.equal(values.has('sb-proj-auth-token-code-verifier'), false);
  assert.equal(cache.sites, '');
  assert.equal(cache.person, '');
  assert.equal(href, SIGN_IN_HREF);
  assert.equal(href, '/login');
});

test('SIGNED_OUT does not restore a session that is still in storage', () => {
  assert.equal(userIdAfterAuthEvent('SIGNED_OUT', null, 'user-1'), null);
  assert.equal(userIdAfterAuthEvent('SIGNED_OUT', 'user-1', 'user-1'), null);
  assert.equal(userIdAfterAuthEvent('INITIAL_SESSION', null, 'user-1'), 'user-1');
  assert.equal(userIdAfterAuthEvent('TOKEN_REFRESHED', 'user-1', null), 'user-1');
});
