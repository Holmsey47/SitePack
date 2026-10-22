import assert from 'node:assert/strict';
import test from 'node:test';
import { decideHardwareBack } from './hardwareBack.ts';

test('hardware back closes an open sheet before anything else', () => {
  assert.equal(
    decideHardwareBack({
      overlayOpen: true,
      uploadInProgress: true,
      pathname: '/sites',
      canGoBack: false,
    }),
    'close-overlay'
  );
  assert.equal(
    decideHardwareBack({
      overlayOpen: true,
      uploadInProgress: false,
      pathname: '/sites/oak/upload',
      canGoBack: true,
    }),
    'close-overlay'
  );
});

test('hardware back confirms before leaving an upload that is still running', () => {
  assert.equal(
    decideHardwareBack({
      overlayOpen: false,
      uploadInProgress: true,
      pathname: '/sites/oak/upload',
      canGoBack: true,
    }),
    'confirm-upload'
  );
  assert.equal(
    decideHardwareBack({
      overlayOpen: false,
      uploadInProgress: true,
      pathname: '/sites/oak/upload/',
      canGoBack: true,
    }),
    'confirm-upload'
  );
  assert.equal(
    decideHardwareBack({
      overlayOpen: false,
      uploadInProgress: false,
      pathname: '/sites/oak/upload',
      canGoBack: true,
    }),
    'go-back'
  );
});

test('hardware back exits only from the sites list', () => {
  for (const pathname of ['/sites', '/sites/', '/(app)/sites', '/(app)/sites/index']) {
    assert.equal(
      decideHardwareBack({
        overlayOpen: false,
        uploadInProgress: false,
        pathname,
        canGoBack: true,
      }),
      'exit',
      pathname
    );
  }
  assert.equal(
    decideHardwareBack({
      overlayOpen: false,
      uploadInProgress: false,
      pathname: '/sites/oak',
      canGoBack: true,
    }),
    'go-back'
  );
  assert.equal(
    decideHardwareBack({
      overlayOpen: false,
      uploadInProgress: false,
      pathname: '/login',
      canGoBack: false,
    }),
    'stay'
  );
  assert.equal(
    decideHardwareBack({
      overlayOpen: false,
      uploadInProgress: false,
      pathname: '/people',
      canGoBack: true,
    }),
    'go-back'
  );
});
