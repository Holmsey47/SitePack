import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SECURE_CHUNK_BYTES,
  joinSecureChunks,
  secureChunkKey,
  secureStoreKey,
  splitSecureValue,
} from './secureChunks.ts';

test('session values split under the SecureStore limit and join back', () => {
  const value = `${'a'.repeat(SECURE_CHUNK_BYTES + 50)}é`;
  const chunks = splitSecureValue(value);
  assert.ok(chunks.length >= 2);
  const encoder = new TextEncoder();
  for (const chunk of chunks) {
    assert.ok(encoder.encode(chunk).length <= SECURE_CHUNK_BYTES);
  }
  assert.equal(joinSecureChunks(chunks), value);
  assert.deepEqual(splitSecureValue(''), ['']);
});

test('SecureStore keys stay within the allowed character set', () => {
  assert.equal(secureStoreKey('sb-project-auth-token'), 'sb-project-auth-token');
  assert.equal(secureStoreKey('sb/project auth'), 'sb_project_auth');
  assert.equal(secureChunkKey('sb-project-auth-token', 1), 'sb-project-auth-token.1');
});
