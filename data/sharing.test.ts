import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SHARE_COMPANY_PLACEHOLDER,
  SHARE_SECTION_DEFAULTS,
  accessRemovedMessage,
  classifyShareFailure,
  droppedSharedSiteIds,
  forgetSharedSiteStorage,
  rememberSharedSiteIds,
  shareCompanyKey,
  shareFailureNotice,
  shareFailureRetries,
  shareInviteText,
  withShareRetry,
} from './sharing.ts';

test('sections start off and the company placeholder is your company', () => {
  assert.deepEqual(SHARE_SECTION_DEFAULTS, {
    drawings: false,
    variations: false,
    snags: false,
    sign_in: false,
    inductions: false,
  });
  assert.equal(SHARE_COMPANY_PLACEHOLDER, 'your company');
  assert.equal(SHARE_COMPANY_PLACEHOLDER.includes('[company]'), false);
});

test('a company key ignores case and extra spaces', () => {
  assert.equal(shareCompanyKey('  Firm   Y '), 'firm y');
  assert.notEqual(shareCompanyKey('Firm Y'), shareCompanyKey('Firm Z'));
});

test('network, 408, 429, and 5xx retry, and a business code becomes a notice', async () => {
  assert.equal(shareFailureRetries(classifyShareFailure(new TypeError('Failed to fetch'))), true);
  assert.equal(shareFailureRetries(classifyShareFailure({ status: 408, message: 'timeout' })), true);
  assert.equal(shareFailureRetries(classifyShareFailure({ status: 429, message: 'slow down' })), true);
  assert.equal(shareFailureRetries(classifyShareFailure({ status: 503, message: 'down' })), true);
  const revoked = classifyShareFailure(new Error('share_revoked'));
  assert.deepEqual(revoked, { kind: 'business', code: 'share_revoked' });
  assert.equal(shareFailureRetries(revoked), false);
  assert.equal(shareFailureNotice(revoked), accessRemovedMessage());
  assert.match(shareFailureNotice(classifyShareFailure(new Error('other_firm'))), /different company/);
  assert.equal(shareFailureRetries(classifyShareFailure({ status: 400, message: 'bad' })), false);

  let calls = 0;
  const value = await withShareRetry(async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('Failed to fetch');
    return 'ok';
  });
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
  await assert.rejects(
    () => withShareRetry(async () => Promise.reject(new Error('code_used'))),
    /code_used/
  );
});

test('a share link keeps the code and names a company', () => {
  const text = shareInviteText({ company: 'Northbuild', site: 'Harbour Point', code: 'ABCD2345' });
  assert.match(text, /Northbuild/);
  assert.match(text, /Harbour Point/);
  assert.match(text, /\/share\/ABCD2345/);
  assert.match(text, /ABCD-2345/);
});

test('dropping a shared site wipes that site only', () => {
  const saved = new Map<string, string>();
  const storage = {
    get length() {
      return saved.size;
    },
    key(index: number) {
      return [...saved.keys()][index] ?? null;
    },
    getItem(key: string) {
      return saved.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      saved.set(key, value);
    },
    removeItem(key: string) {
      saved.delete(key);
    },
  };
  saved.set(
    'sitepack.offline.sites',
    JSON.stringify([
      { id: 'site-a', name: 'A' },
      { id: 'site-b', name: 'B' },
    ])
  );
  saved.set('sitepack.offline.pack.site-a', '{"siteId":"site-a"}');
  saved.set('sitepack.offline.pack.site-b', '{"siteId":"site-b"}');
  saved.set(
    'sitepack.snag.queue',
    JSON.stringify([
      { siteId: 'site-a', note: 'gone' },
      { siteId: 'site-b', note: 'stay' },
    ])
  );
  forgetSharedSiteStorage(storage, 'site-a');
  assert.equal(saved.has('sitepack.offline.pack.site-a'), false);
  assert.equal(saved.has('sitepack.offline.pack.site-b'), true);
  assert.deepEqual(JSON.parse(saved.get('sitepack.offline.sites') ?? '[]'), [{ id: 'site-b', name: 'B' }]);
  assert.deepEqual(JSON.parse(saved.get('sitepack.snag.queue') ?? '[]'), [{ siteId: 'site-b', note: 'stay' }]);
  assert.deepEqual(droppedSharedSiteIds(['site-a', 'site-b'], ['site-b']), ['site-a']);
  saved.set('sitepack.shared.ids', JSON.stringify(['site-a', 'site-b']));
  assert.deepEqual(rememberSharedSiteIds(storage, ['site-b']), ['site-a']);
  assert.deepEqual(JSON.parse(saved.get('sitepack.shared.ids') ?? '[]'), ['site-b']);
});
