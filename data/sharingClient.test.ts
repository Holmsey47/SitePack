import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { snagRpcError } from './snagFailure.ts';
import {
  classifyShareFailure,
  shareFailureNotice,
  shareFailureRetries,
  throwShareFunction,
  withShareRetry,
} from './sharing.ts';

const KEY = 'sb_publishable_test_key';

function client(fetchImpl: typeof fetch) {
  return createClient('https://example.supabase.co', KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchImpl },
  });
}

test('a real supabase client retries 503, 429, 504, and an abort, and a 4xx becomes a notice', async () => {
  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  assert.match(
    repo,
    /throw snagRpcError\(response\.error \?\? \{ message: String\(response\.status \?\? ''\) \}, response\.status\)/
  );
  assert.match(repo, /await throwShareFunction\(error\)/);

  const shapes = [
    { status: 503, body: 'upstream connect error', type: 'text/plain', retry: true },
    {
      status: 429,
      body: JSON.stringify({ message: 'slow down', code: '429', details: null, hint: null }),
      type: 'application/json',
      retry: true,
    },
    { status: 504, body: 'gateway timeout', type: 'text/plain', retry: true },
    {
      status: 400,
      body: JSON.stringify({ code: 'PGRST202', details: null, hint: null, message: 'invalid_path' }),
      type: 'application/json',
      retry: false,
      notice: /cannot be opened/,
    },
    {
      status: 400,
      body: JSON.stringify({ code: 'PGRST202', details: null, hint: null, message: 'Could not find the function' }),
      type: 'application/json',
      retry: false,
      notice: /That did not work/,
    },
  ];

  for (const shape of shapes) {
    const supabase = client(
      async () => new Response(shape.body, { status: shape.status, headers: { 'content-type': shape.type } })
    );
    const response = await supabase.rpc('shared_drawings', {
      p_site_id: '00000000-0000-0000-0000-000000000001',
    });
    assert.equal(response.status, shape.status);
    assert.equal((response.error as { status?: number } | null)?.status, undefined);
    let thrown: unknown;
    try {
      throw snagRpcError(response.error ?? { message: String(response.status ?? '') }, response.status);
    } catch (error) {
      thrown = error;
    }
    const failure = classifyShareFailure(thrown);
    assert.equal(shareFailureRetries(failure), shape.retry, String(shape.status));
    const notice = shareFailureNotice(failure);
    if (shape.retry) assert.equal(notice, 'The connection dropped. Try again.');
    else assert.match(notice, shape.notice ?? /That did not work/);
  }

  const aborted = client(async () => {
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    throw error;
  });
  const abortResponse = await aborted.rpc('shared_drawings', {
    p_site_id: '00000000-0000-0000-0000-000000000001',
  });
  assert.equal(abortResponse.status, 0);
  assert.equal((abortResponse.error as { status?: number } | null)?.status, undefined);
  let abortThrown: unknown;
  try {
    throw snagRpcError(abortResponse.error, abortResponse.status);
  } catch (error) {
    abortThrown = error;
  }
  const abortFailure = classifyShareFailure(abortThrown);
  assert.equal(shareFailureRetries(abortFailure), true);
  assert.equal(shareFailureNotice(abortFailure), 'The connection dropped. Try again.');

  let attempts = 0;
  const value = await withShareRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw abortThrown;
    return 'opened';
  });
  assert.equal(value, 'opened');
  assert.equal(attempts, 3);
});

test('a network failure on a share function is retried and a business code is a notice', async () => {
  const dropped = client(async () => {
    throw new TypeError('Failed to fetch');
  });
  const missed = await dropped.functions.invoke('share-drawing-url', { body: { drawing_id: 'x' } });
  assert.equal(missed.error?.name, 'FunctionsFetchError');
  let network: unknown;
  try {
    await throwShareFunction(missed.error);
  } catch (error) {
    network = error;
  }
  assert.equal(shareFailureRetries(classifyShareFailure(network)), true);
  assert.equal(shareFailureNotice(classifyShareFailure(network)), 'The connection dropped. Try again.');

  const refused = client(
    async () =>
      new Response(JSON.stringify({ error: 'invalid_path' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
  );
  const http = await refused.functions.invoke('share-drawing-url', { body: { drawing_id: 'x' } });
  let business: unknown;
  try {
    await throwShareFunction(http.error);
  } catch (error) {
    business = error;
  }
  const failure = classifyShareFailure(business);
  assert.equal(shareFailureRetries(failure), false);
  assert.match(shareFailureNotice(failure), /cannot be opened/);

  const other = client(async () => new Response('no', { status: 404, headers: { 'content-type': 'text/plain' } }));
  const plain = await other.functions.invoke('redeem-site-share', { body: { code: 'ABCD2345' } });
  let noticeError: unknown;
  try {
    await throwShareFunction(plain.error);
  } catch (error) {
    noticeError = error;
  }
  assert.equal(shareFailureRetries(classifyShareFailure(noticeError)), false);
  assert.equal(shareFailureNotice(classifyShareFailure(noticeError)), 'That did not work.');
});
