import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { decideHardwareBack, DOWNLOAD_CARRIES_ON, PRESS_BACK_AGAIN, type HardwareBackAction } from './hardwareBack.ts';

function decide(
  input: Partial<Parameters<typeof decideHardwareBack>[0]> & { pathname: string }
): HardwareBackAction {
  return decideHardwareBack({
    overlayOpen: false,
    uploadInProgress: false,
    downloadInProgress: false,
    canGoBack: false,
    now: 10_000,
    exitArmedUntil: 0,
    ...input,
  });
}

test('hardware back closes an open sheet before anything else', () => {
  assert.equal(
    decide({
      overlayOpen: true,
      uploadInProgress: true,
      downloadInProgress: true,
      pathname: '/sites',
      canGoBack: false,
    }),
    'close-overlay'
  );
  assert.equal(
    decide({
      overlayOpen: true,
      pathname: '/sites/oak/upload',
      canGoBack: true,
    }),
    'close-overlay'
  );
});

test('hardware back confirms before leaving an upload that is still running', () => {
  assert.equal(
    decide({
      uploadInProgress: true,
      pathname: '/sites/oak/upload',
      canGoBack: true,
    }),
    'confirm-upload'
  );
  assert.equal(
    decide({
      uploadInProgress: true,
      pathname: '/sites/oak/upload/',
      canGoBack: true,
    }),
    'confirm-upload'
  );
  assert.equal(
    decide({
      pathname: '/sites/oak/upload',
      canGoBack: true,
    }),
    'go-back'
  );
});

test('the sites list arms an exit, then exits on a second back within 2 seconds', () => {
  for (const pathname of ['/sites', '/sites/', '/(app)/sites', '/(app)/sites/index']) {
    assert.equal(decide({ pathname, canGoBack: true, now: 5_000, exitArmedUntil: 0 }), 'arm-exit', pathname);
  }
  assert.equal(decide({ pathname: '/sites', now: 6_999, exitArmedUntil: 7_000 }), 'exit');
  assert.equal(decide({ pathname: '/sites', now: 7_000, exitArmedUntil: 7_000 }), 'arm-exit');
});

test('hardware back leaves a site, and exits welcome, start, sign-in, set-password, join, and reset with no history', () => {
  assert.equal(decide({ pathname: '/sites/oak', canGoBack: true }), 'go-back');
  assert.equal(decide({ pathname: '/people', canGoBack: true }), 'go-back');
  assert.equal(decide({ pathname: '/people', canGoBack: false }), 'stay');
  for (const pathname of ['/welcome', '/start', '/login', '/set-password', '/join', '/join/AB12', '/reset', '/reset/AB12']) {
    assert.equal(decide({ pathname, canGoBack: false }), 'exit', pathname);
    assert.equal(decide({ pathname, canGoBack: true }), 'go-back', pathname);
  }
});

test('back during a pack download says the download carries on, and does not beat a sheet or an upload', () => {
  assert.equal(
    decide({
      downloadInProgress: true,
      pathname: '/sites/oak',
      canGoBack: true,
    }),
    'note-download'
  );
  assert.equal(
    decide({
      downloadInProgress: true,
      uploadInProgress: true,
      pathname: '/sites/oak/upload',
      canGoBack: true,
    }),
    'confirm-upload'
  );
  assert.equal(DOWNLOAD_CARRIES_ON, 'Download carries on');
  assert.equal(PRESS_BACK_AGAIN, 'Press back again to exit');
  const pack = fs.readFileSync('app/(app)/sites/[siteId]/index.tsx', 'utf8');
  assert.match(pack, /showBackToast\(DOWNLOAD_CARRIES_ON\)/);
});

test('leaving an upload tells the truth: the request keeps running', () => {
  const upload = fs.readFileSync('app/(app)/sites/[siteId]/upload.tsx', 'utf8');
  assert.match(upload, /The upload keeps going\. It becomes current when it finishes\./);
  assert.doesNotMatch(upload, /The current drawing stays as it is/);
  assert.doesNotMatch(upload, /Leave and cancel upload/);
  assert.match(upload, /label="Stay"/);
});
