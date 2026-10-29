import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  authTokensFromUrl,
  browserPathWithoutAuth,
  captureIncomingLink,
  joinCodeFromPath,
  peekStagedJoinCode,
  peekStagedResetCode,
  pkceCodeFromUrl,
  resetAppLinkCapture,
  resetCodeFromPath,
  routerPathFromLink,
} from './appLinks.ts';

const FINGERPRINT =
  '83:C8:DD:E7:8A:3A:2B:A4:26:B6:CC:B4:DF:ED:CF:53:DC:DD:64:54:3C:28:11:A6:29:07:8F:07:49:16:57:B6';

test('join and reset codes come from one path segment', () => {
  assert.equal(joinCodeFromPath('/join/K7QM4XPR'), 'K7QM4XPR');
  assert.equal(joinCodeFromPath('/join/K7QM-4XPR'), 'K7QM-4XPR');
  assert.equal(joinCodeFromPath('/join'), null);
  assert.equal(joinCodeFromPath('/join/'), null);
  assert.equal(joinCodeFromPath('/joined/K7QM4XPR'), null);
  assert.equal(joinCodeFromPath('/join/K7QM4XPR/extra'), null);
  assert.equal(resetCodeFromPath('/reset/K7QM4XPR'), 'K7QM4XPR');
  assert.equal(resetCodeFromPath('/reset'), null);
  assert.equal(resetCodeFromPath('/reset/'), null);
  assert.equal(resetCodeFromPath('/set-password'), null);
});

test('session tokens are read from the hash only, and a PKCE code is not a token', () => {
  assert.deepEqual(
    authTokensFromUrl('https://sitepack-preview.vercel.app/set-password#access_token=aaa&refresh_token=bbb&type=invite'),
    { accessToken: 'aaa', refreshToken: 'bbb', type: 'invite' }
  );
  assert.equal(
    authTokensFromUrl(
      'https://sitepack-preview.vercel.app/reset?access_token=aaa&refresh_token=bbb&type=recovery'
    ),
    null
  );
  assert.equal(authTokensFromUrl('https://sitepack-preview.vercel.app/set-password'), null);
  assert.equal(authTokensFromUrl('https://sitepack-preview.vercel.app/set-password?code=abc'), null);
  assert.equal(
    authTokensFromUrl('https://sitepack-preview.vercel.app/set-password?access_token=aaa&refresh_token=bbb'),
    null
  );
  assert.equal(authTokensFromUrl('https://sitepack-preview.vercel.app/set-password#access_token=aaa&type=invite'), null);
  assert.equal(pkceCodeFromUrl('https://sitepack-preview.vercel.app/set-password?code=abc'), 'abc');
  assert.equal(pkceCodeFromUrl('sitepack://set-password?code=abc'), 'abc');
  assert.equal(pkceCodeFromUrl('https://sitepack-preview.vercel.app/reset?code=abc'), 'abc');
  assert.equal(pkceCodeFromUrl('https://sitepack-preview.vercel.app/join/K7QM4XPR?code=abc'), null);
  assert.equal(
    pkceCodeFromUrl(
      'https://sitepack-preview.vercel.app/set-password?code=abc&access_token=aaa&refresh_token=bbb&type=invite'
    ),
    'abc'
  );
  assert.equal(
    pkceCodeFromUrl(
      'https://sitepack-preview.vercel.app/set-password?code=abc#access_token=aaa&refresh_token=bbb&type=invite'
    ),
    null
  );
});

test('the router path keeps neither the code nor the tokens', () => {
  resetAppLinkCapture();
  const joinPath = captureIncomingLink('https://sitepack-preview.vercel.app/join/K7QM4XPR');
  assert.equal(joinPath, '/join');
  assert.equal(peekStagedJoinCode(), 'K7QM4XPR');

  resetAppLinkCapture();
  const resetPath = captureIncomingLink('https://sitepack-preview.vercel.app/reset/K7QM4XPR');
  assert.equal(resetPath, '/reset');
  assert.equal(peekStagedResetCode(), 'K7QM4XPR');

  resetAppLinkCapture();
  const tokenUrl =
    'https://sitepack-preview.vercel.app/set-password#access_token=aaa&refresh_token=bbb&type=invite';
  assert.equal(captureIncomingLink(tokenUrl), '/set-password');
  assert.equal(captureIncomingLink(tokenUrl).includes('aaa'), false);
  assert.equal(captureIncomingLink(tokenUrl).includes('access_token'), false);

  resetAppLinkCapture();
  const queryUrl =
    'https://sitepack-preview.vercel.app/set-password?access_token=aaa&refresh_token=bbb&type=recovery&next=1';
  assert.equal(routerPathFromLink(queryUrl), '/set-password?next=1');
  assert.equal(browserPathWithoutAuth(queryUrl), '/set-password?next=1');
  assert.equal(captureIncomingLink(queryUrl).includes('aaa'), false);
  assert.equal(captureIncomingLink(queryUrl).includes('access_token'), false);

  resetAppLinkCapture();
  assert.equal(captureIncomingLink('https://sitepack-preview.vercel.app/reset?code=abc'), '/reset');
  assert.equal(browserPathWithoutAuth('https://sitepack-preview.vercel.app/join/K7QM4XPR'), '/join/K7QM4XPR');
});

test('a leading double slash collapses to one slash', () => {
  assert.equal(routerPathFromLink('//evil.example/x'), '/evil.example/x');
  resetAppLinkCapture();
  assert.equal(captureIncomingLink('//evil.example/x'), '/evil.example/x');
  resetAppLinkCapture();
  assert.equal(captureIncomingLink('//join/K7QM4XPR'), '/join');
  assert.equal(peekStagedJoinCode(), 'K7QM4XPR');
});

test('the route drops the hash before a session can be stored', () => {
  const hash = '#access_token=aaa&refresh_token=bbb&type=invite';
  const urls = [
    `https://sitepack-preview.vercel.app/set-password${hash}`,
    `https://sitepack-preview.vercel.app/reset${hash}`,
    `https://sitepack-preview.vercel.app/reset/AB12${hash}`,
    `sitepack://set-password${hash}`,
    `https://evil.example/set-password${hash}`,
    `http://sitepack-preview.vercel.app/set-password${hash}`,
    `https://sitepack-preview.vercel.app/sites${hash}`,
  ];
  for (const url of urls) {
    resetAppLinkCapture();
    const next = captureIncomingLink(url);
    assert.equal(next.includes('aaa'), false);
    assert.equal(next.includes('access_token'), false);
    assert.equal(next.startsWith('//'), false);
  }
  resetAppLinkCapture();
  assert.equal(captureIncomingLink(`https://sitepack-preview.vercel.app/join/K7QM4XPR${hash}`), '/join');
  assert.equal(peekStagedJoinCode(), 'K7QM4XPR');
});

test('assetlinks names the package and the release fingerprint', () => {
  const asset = JSON.parse(fs.readFileSync(new URL('../public/.well-known/assetlinks.json', import.meta.url), 'utf8'));
  assert.equal(asset.length, 1);
  assert.deepEqual(asset[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(asset[0].target.namespace, 'android_app');
  assert.equal(asset[0].target.package_name, 'uk.sitepack.app');
  assert.deepEqual(asset[0].target.sha256_cert_fingerprints, [FINGERPRINT]);
});

test('app.json opens only the join, set-password, and reset https paths', () => {
  const app = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.equal(app.expo.android.package, 'uk.sitepack.app');
  assert.equal(Number.isInteger(app.expo.android.versionCode), true);
  assert.equal(app.expo.android.versionCode >= 2, true);
  assert.deepEqual(app.expo.android.blockedPermissions, [
    'SYSTEM_ALERT_WINDOW',
    'RECORD_AUDIO',
    'READ_EXTERNAL_STORAGE',
    'WRITE_EXTERNAL_STORAGE',
    'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
  ]);
  assert.ok(
    app.expo.android.blockedPermissions.includes(
      'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE'
    )
  );
  const filters = app.expo.android.intentFilters;
  assert.equal(filters.length, 1);
  assert.equal(filters[0].action, 'VIEW');
  assert.equal(filters[0].autoVerify, true);
  assert.deepEqual(filters[0].category, ['BROWSABLE', 'DEFAULT']);
  assert.deepEqual(
    filters[0].data.map((item) => `${item.scheme} ${item.host} ${item.path ?? ''} ${item.pathPrefix ?? ''}`),
    [
      'https sitepack-preview.vercel.app  /join/',
      'https sitepack-preview.vercel.app /set-password ',
      'https sitepack-preview.vercel.app /reset ',
      'https sitepack-preview.vercel.app  /reset/',
    ]
  );
});

test('the spa rewrite regex excludes assetlinks and still serves the app', () => {
  const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const spa = vercel.rewrites.find((rule) => rule.destination === '/index.html');
  const pattern = new RegExp(`^${spa.source}$`);
  assert.equal(pattern.test('/.well-known/assetlinks.json'), false);
  assert.equal(pattern.test('/.well-known/'), false);
  assert.equal(pattern.test('/join/K7QM4XPR'), true);
  assert.equal(pattern.test('/set-password'), true);
  assert.equal(pattern.test('/reset'), true);
  assert.equal(pattern.test('/reset/K7QM4XPR'), true);
  assert.equal(pattern.test('/'), true);
  assert.equal(pattern.test('/sites'), true);
});
