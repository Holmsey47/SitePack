import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { subscribeOnline } from './onlineSignal.ts';
import { createReconnectRefetch, readWebOffline } from './reconnectRefetch.ts';
import { fixtureForceOffline, setFixtureForceOffline } from './variationQueue.ts';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  key: (index: number) => string | null;
  readonly length: number;
  clear: () => void;
};

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
  };
}

function installBrowser() {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  const listeners = new Map<string, Array<() => void>>();
  const target = {
    navigator: { onLine: true },
    addEventListener(type: string, fn: () => void) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== fn));
    },
    dispatchEvent(event: { type: string }) {
      for (const fn of listeners.get(event.type) ?? []) fn();
      return true;
    },
  };
  globalThis.localStorage = memoryStorage() as Storage;
  globalThis.window = target as unknown as Window & typeof globalThis.window;
  return {
    target,
    restore() {
      globalThis.window = previousWindow;
      globalThis.localStorage = previousStorage;
    },
  };
}

function withFixtures<T>(enabled: boolean, run: () => T): T {
  const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;
  const previousFixtures = process.env.EXPO_PUBLIC_USE_FIXTURES;
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  if (enabled) process.env.EXPO_PUBLIC_USE_FIXTURES = '1';
  else delete process.env.EXPO_PUBLIC_USE_FIXTURES;
  try {
    return run();
  } finally {
    (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
    if (previousFixtures === undefined) delete process.env.EXPO_PUBLIC_USE_FIXTURES;
    else process.env.EXPO_PUBLIC_USE_FIXTURES = previousFixtures;
  }
}

test('fixtures on: the offline switch then online refetches exactly once', async () => {
  const browser = installBrowser();
  try {
  await withFixtures(true, async () => {
    let loads = 0;
    const refetch = createReconnectRefetch({
      initiallyOffline: readWebOffline(),
      load: () => {
        loads += 1;
      },
      subscribe: (handlers) => subscribeOnline('web', handlers, { windowTarget: globalThis.window }),
    });
    assert.equal(readWebOffline(), false);
    assert.equal(loads, 0);
    setFixtureForceOffline(true);
    assert.equal(fixtureForceOffline(), true);
    assert.equal(readWebOffline(), true);
    assert.equal(loads, 0);
    setFixtureForceOffline(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fixtureForceOffline(), false);
    assert.equal(loads, 1);
    setFixtureForceOffline(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(loads, 1);
    refetch.stop();
  });
  } finally {
    browser.restore();
  }
});

test('fixtures off: the offline switch stores nothing and does not refetch', async () => {
  const browser = installBrowser();
  let events = 0;
  const realDispatch = browser.target.dispatchEvent.bind(browser.target);
  browser.target.dispatchEvent = (event) => {
    events += 1;
    return realDispatch(event);
  };
  try {
  await withFixtures(false, async () => {
    let loads = 0;
    createReconnectRefetch({
      initiallyOffline: readWebOffline(),
      load: () => {
        loads += 1;
      },
      subscribe: (handlers) => subscribeOnline('web', handlers, { windowTarget: globalThis.window }),
    });
    globalThis.localStorage.setItem('sitepack.dev.forceOffline', '1');
    setFixtureForceOffline(true);
    setFixtureForceOffline(false);
    assert.equal(fixtureForceOffline(), false);
    assert.equal(readWebOffline(), false);
    assert.equal(events, 0);
    assert.equal(loads, 0);
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    process.env.EXPO_PUBLIC_USE_FIXTURES = '1';
    setFixtureForceOffline(true);
    assert.equal(fixtureForceOffline(), false);
    assert.equal(events, 0);
  });
  } finally {
    browser.restore();
  }
});

test('the fixture switch has no URL toggle and the prod bundle check still forbids it', () => {
  const source = fs.readFileSync('lib/variationQueue.ts', 'utf8');
  assert.match(source, /__DEV__ && process\.env\.EXPO_PUBLIC_USE_FIXTURES === '1'/);
  assert.match(source, /dispatchEvent\(new Event\(offline \? 'offline' : 'online'\)\)/);
  assert.doesNotMatch(source, /URLSearchParams|location\.search|forceOffline=/);
  const bundle = fs.readFileSync('scripts/check-prod-bundle.mjs', 'utf8');
  assert.match(bundle, /sitepack\.dev\.forceOffline/);
  const exported = fs.readFileSync('scripts/export-web.mjs', 'utf8');
  assert.match(exported, /EXPO_PUBLIC_USE_FIXTURES === '1'/);
  const hook = fs.readFileSync('hooks/useRefetchOnReconnect.ts', 'utf8');
  assert.match(hook, /readWebOffline\(\)/);
});
