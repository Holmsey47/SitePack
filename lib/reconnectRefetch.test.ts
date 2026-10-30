import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { OFFLINE_SHOWING_SAVED, OFFLINE_SNAGS_LATER } from './offlineCopy.ts';
import { createReconnectRefetch } from './reconnectRefetch.ts';

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
