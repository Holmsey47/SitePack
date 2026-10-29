import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import TestRenderer from 'react-test-renderer';

const mockUrl = new URL('../scripts/react-native-mock.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') return nextResolve(mockUrl, context);
    return nextResolve(specifier, context);
  },
});

test('PhoneStatus does not touch addEventListener on ios or android', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const previous = globalThis.window;
  const calls = [];
  globalThis.window = {
    addEventListener: (type) => {
      calls.push(type);
    },
    removeEventListener: () => undefined,
    navigator: { onLine: true },
  };
  const { setPlatformOS } = await import('../scripts/react-native-mock.mjs');
  const { PhoneStatus } = await import('./phone-status.tsx');
  try {
    for (const os of ['ios', 'android']) {
      calls.length = 0;
      delete globalThis.window.addEventListener;
      assert.equal(typeof globalThis.window.addEventListener, 'undefined');
      setPlatformOS(os);
      let renderer;
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(createElement(PhoneStatus));
      });
      assert.equal(renderer.toJSON(), null);
      assert.deepEqual(calls, []);
      await TestRenderer.act(async () => {
        renderer.unmount();
      });
    }
    calls.length = 0;
    globalThis.window.addEventListener = (type) => {
      calls.push(type);
    };
    setPlatformOS('web');
    const { browserCanListenOnline, PhoneStatus: Status } = await import('./phone-status.tsx');
    assert.equal(browserCanListenOnline(), true);
    let webRenderer;
    await TestRenderer.act(async () => {
      webRenderer = TestRenderer.create(createElement(Status));
    });
    assert.deepEqual(calls, ['online', 'offline']);
    await TestRenderer.act(async () => {
      webRenderer.unmount();
    });
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
