import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { OFFLINE_SHOWING_SAVED, OFFLINE_SNAGS_LATER } from './offlineCopy.ts';
import { subscribeOnline } from './onlineSignal.ts';
import { createReconnectRefetch, readWebOffline } from './reconnectRefetch.ts';
import { setFixtureForceOffline } from './variationQueue.ts';

type Handlers = { onOnline: () => void; onOffline: () => void };

function harness(initiallyOffline: boolean) {
  let online: () => void = () => {};
  let offline: () => void = () => {};
  let loads = 0;
  let error = initiallyOffline ? OFFLINE_SNAGS_LATER : '';
  let rows = initiallyOffline ? [] as string[] : ['S-1'];
  let release: () => void = () => {};
  let gate: Promise<void> = Promise.resolve();
  const refetch = createReconnectRefetch({
    initiallyOffline,
    subscribe(handlers: Handlers) {
      online = handlers.onOnline;
      offline = handlers.onOffline;
      return () => {};
    },
    load: () => {
      loads += 1;
      gate = new Promise<void>((resolve) => {
        release = () => {
          rows = ['S-1'];
          error = '';
          resolve();
        };
      });
      return gate;
    },
  });
  return {
    refetch,
    online: () => online(),
    offline: () => offline(),
    finish: () => release(),
    loads: () => loads,
    error: () => error,
    rows: () => rows,
  };
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('an offline-to-online transition refetches once and clears the offline line', async () => {
  const screen = harness(true);
  screen.online();
  assert.equal(screen.loads(), 1);
  screen.online();
  assert.equal(screen.loads(), 1);
  screen.finish();
  await tick();
  assert.equal(screen.error(), '');
  assert.deepEqual(screen.rows(), ['S-1']);
  screen.online();
  assert.equal(screen.loads(), 1);
});

test('a cached offline list refreshes in place when the signal returns', async () => {
  let error = OFFLINE_SHOWING_SAVED;
  let rows = ['cached'];
  let loads = 0;
  let online: () => void = () => {};
  createReconnectRefetch({
    initiallyOffline: true,
    subscribe(handlers) {
      online = handlers.onOnline;
      return () => {};
    },
    load: async () => {
      loads += 1;
      rows = ['fresh'];
      error = '';
    },
  });
  online();
  await tick();
  assert.equal(loads, 1);
  assert.equal(error, '');
  assert.deepEqual(rows, ['fresh']);
});

test('no refetch after unmount, and an in-flight load is not started twice', async () => {
  const screen = harness(true);
  screen.online();
  assert.equal(screen.loads(), 1);
  screen.offline();
  screen.online();
  assert.equal(screen.loads(), 1);
  screen.refetch.stop();
  screen.finish();
  await tick();
  screen.offline();
  screen.online();
  await tick();
  assert.equal(screen.loads(), 1);
});

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

test('Snags opened while offline, then an online event refetches exactly once', async () => {
  const browser = installBrowser();
  try {
    await withFixtures(true, async () => {
      setFixtureForceOffline(true);
      assert.equal(browser.target.navigator.onLine, true);
      assert.equal(readWebOffline(), true);
      let probe = 0;
      const stopProbe = subscribeOnline(
        'web',
        {
          onOnline: () => {
            probe += 1;
          },
          onOffline: () => {},
        },
        { windowTarget: browser.target }
      );
      assert.equal(probe, 0);
      stopProbe();

      let loads = 0;
      let later: () => void = () => {};
      const opened = createReconnectRefetch({
        initiallyOffline: true,
        subscribe(handlers) {
          // navigator.onLine is true, so the old subscribe called this before returning.
          handlers.onOnline();
          later = handlers.onOnline;
          return () => {};
        },
        load: () => {
          loads += 1;
        },
      });
      assert.equal(loads, 0);
      later();
      assert.equal(loads, 1);
      later();
      assert.equal(loads, 1);
      opened.stop();

      let live = 0;
      const screen = createReconnectRefetch({
        initiallyOffline: readWebOffline(),
        subscribe: (handlers) => subscribeOnline('web', handlers, { windowTarget: browser.target }),
        load: () => {
          live += 1;
        },
      });
      assert.equal(live, 0);
      setFixtureForceOffline(false);
      await tick();
      assert.equal(live, 1);
      browser.target.dispatchEvent({ type: 'online' });
      await tick();
      assert.equal(live, 1);
      screen.stop();
    });
  } finally {
    browser.restore();
  }
});

test('navigator.onLine was true at subscribe, but the load failed, then an online event refetches', async () => {
  const browser = installBrowser();
  try {
    await withFixtures(true, async () => {
      assert.equal(browser.target.navigator.onLine, true);
      assert.equal(readWebOffline(), false);
      let loads = 0;
      const screen = createReconnectRefetch({
        initiallyOffline: readWebOffline(),
        subscribe: (handlers) => subscribeOnline('web', handlers, { windowTarget: browser.target }),
        load: () => {
          loads += 1;
        },
      });
      assert.equal(loads, 0);
      try {
        throw new TypeError('Failed to fetch');
      } catch (err) {
        assert.equal(err instanceof TypeError, true);
        screen.noteOffline();
      }
      assert.equal(loads, 0);
      browser.target.dispatchEvent({ type: 'online' });
      await tick();
      assert.equal(loads, 1);
      browser.target.dispatchEvent({ type: 'online' });
      await tick();
      assert.equal(loads, 1);
      screen.stop();
      const snags = fs.readFileSync('app/(app)/sites/[siteId]/snags/index.tsx', 'utf8');
      assert.match(snags, /noteOfflineRef\.current\(\)/);
      const variations = fs.readFileSync('app/(app)/sites/[siteId]/variations/index.tsx', 'utf8');
      assert.match(variations, /noteOfflineRef\.current\(\)/);
    });
  } finally {
    browser.restore();
  }
});

test('opened online, a spurious online event does not refetch', async () => {
  const browser = installBrowser();
  try {
    await withFixtures(false, async () => {
      assert.equal(browser.target.navigator.onLine, true);
      assert.equal(readWebOffline(), false);
      let loads = 0;
      const screen = createReconnectRefetch({
        initiallyOffline: false,
        subscribe: (handlers) => subscribeOnline('web', handlers, { windowTarget: browser.target }),
        load: () => {
          loads += 1;
        },
      });
      assert.equal(loads, 0);
      browser.target.dispatchEvent({ type: 'online' });
      await tick();
      assert.equal(loads, 0);
      screen.stop();
    });
  } finally {
    browser.restore();
  }
});

test('already online does not refetch, and the open screens subscribe while focused', () => {
  const screen = harness(false);
  screen.online();
  assert.equal(screen.loads(), 0);
  const hook = fs.readFileSync('hooks/useRefetchOnReconnect.ts', 'utf8');
  assert.match(hook, /useFocusEffect/);
  assert.match(hook, /subscribeDeviceOnline/);
  assert.match(hook, /createReconnectRefetch/);
  const screens = [
    'app/(app)/sites/[siteId]/snags/index.tsx',
    'app/(app)/sites/[siteId]/variations/index.tsx',
    'app/(app)/sites/[siteId]/index.tsx',
    'app/(app)/sites/[siteId]/folder/[folder].tsx',
    'app/(app)/sites/[siteId]/new.tsx',
    'app/(app)/sites/[siteId]/not-seen/index.tsx',
    'app/(app)/sites/[siteId]/not-seen/[personId].tsx',
    'app/(app)/sites/[siteId]/seen/[drawingId].tsx',
    'app/(app)/sites/[siteId]/drawing/[drawingId].tsx',
    'app/(app)/sites/[siteId]/snags/[snagId].tsx',
    'app/(app)/sites/[siteId]/snags/sign.tsx',
    'app/(app)/sites/[siteId]/variations/[variationId].tsx',
    'app/(app)/people.tsx',
  ];
  for (const path of screens) {
    assert.match(fs.readFileSync(path, 'utf8'), /useRefetchOnReconnect\(/, path);
  }
});
