import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { memoryDrawingSeenQueue, type QueuedSeen } from './drawingSeenQueue.ts';
import {
  createReconnectSync,
  flushOfflineQueues,
  reconnectDelayMs,
  runExclusive,
  type OfflineFlushIo,
} from './offlineFlush.ts';
import { subscribeOnline } from './onlineSignal.ts';
import { memorySnagQueue, type QueuedSnag } from './snagQueue.ts';
import { memoryVariationQueue, type QueuedVariation } from './variationQueue.ts';

function snag(localId = 'local-keep', ownerId = 'user-a'): QueuedSnag {
  return {
    kind: 'create',
    localId,
    ownerId,
    siteId: 'site',
    companyId: 'co',
    note: 'Crack',
    levelArea: null,
    tradeLabel: 'Plaster',
    photos: [],
    raisedAt: '2026-10-30T12:00:00.000Z',
  };
}

function variation(localId = 'var-keep', ownerUserId = 'user-a'): QueuedVariation {
  return {
    localId,
    siteId: 'site',
    companyId: 'co',
    title: 'Extra bead',
    description: 'Replace the cracked bead',
    levelArea: null,
    quantityText: null,
    valuePence: null,
    photos: [],
    savedAt: '2026-10-30T12:00:00.000Z',
    ownerUserId,
    notice: '',
  };
}

function seen(id = 'open:drawing:C:user-a', ownerId = 'user-a'): QueuedSeen {
  return {
    id,
    ownerId,
    kind: 'open',
    drawingId: 'drawing',
    siteId: 'site',
    revision: 'C',
    at: '2026-10-30T12:00:00.000Z',
  };
}

function io(sent: { snags: string[]; variations: string[]; seen: string[] }): OfflineFlushIo {
  return {
    snagQueue: memorySnagQueue(),
    variationQueue: memoryVariationQueue(),
    seenQueue: memoryDrawingSeenQueue(),
    sendSnag: async (item) => {
      sent.snags.push(item.localId);
    },
    sendVariation: async (item) => {
      sent.variations.push(item.localId);
    },
    seenIo: {
      async recordOpen(drawingId) {
        sent.seen.push(drawingId);
      },
      async confirm() {
        return undefined;
      },
    },
  };
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('coming back online sends a queued snag, variation, and seen tap once, with the same ids', async () => {
  const sent = { snags: [] as string[], variations: [] as string[], seen: [] as string[] };
  const queues = io(sent);
  await queues.snagQueue.put(snag());
  await queues.snagQueue.put(snag('other-user', 'user-b'));
  await queues.variationQueue.put(variation());
  await queues.seenQueue.put(seen());

  const first = await flushOfflineQueues('user-a', queues, { releaseRetry: true });
  assert.equal(first.pending, false);
  assert.deepEqual(sent.snags, ['local-keep']);
  assert.deepEqual(sent.variations, ['var-keep']);
  assert.deepEqual(sent.seen, ['drawing']);
  assert.equal((await queues.snagQueue.list()).some((item) => item.localId === 'other-user'), false);

  const second = await flushOfflineQueues('user-a', queues, { releaseRetry: true });
  assert.equal(second.pending, false);
  assert.deepEqual(sent.snags, ['local-keep']);
  assert.deepEqual(sent.variations, ['var-keep']);
  assert.deepEqual(sent.seen, ['drawing']);
});

test('an online flush sends a snag that was waiting out its backoff', async () => {
  const sent = { snags: [] as string[], variations: [] as string[], seen: [] as string[] };
  const queues = io(sent);
  await queues.snagQueue.put({ ...snag(), retryAt: '2099-01-01T00:00:00.000Z' });
  const held = await flushOfflineQueues('user-a', queues, { releaseRetry: false });
  assert.equal(held.pending, true);
  assert.deepEqual(sent.snags, []);
  const released = await flushOfflineQueues('user-a', queues, { releaseRetry: true });
  assert.equal(released.pending, false);
  assert.deepEqual(sent.snags, ['local-keep']);
});

test('two overlapping flushes send the snag once', async () => {
  const queues = io({ snags: [], variations: [], seen: [] });
  await queues.snagQueue.put(snag());
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.sendSnag = async (item) => {
    assert.equal(item.localId, 'local-keep');
    calls += 1;
    await gate;
  };
  const first = runExclusive(() => flushOfflineQueues('user-a', queues));
  const second = runExclusive(() => flushOfflineQueues('user-a', queues));
  await tick();
  assert.equal(calls, 1);
  release();
  await first;
  await second;
  assert.equal(calls, 1);
  assert.equal((await queues.snagQueue.list()).length, 0);
});

test('reconnect flushes immediately and retries inside 10s, then stops', async () => {
  const reasons: string[] = [];
  const delays: number[] = [];
  const retry: { run: (() => void) | null } = { run: null };
  const sync = createReconnectSync({
    ownerId: () => 'user-a',
    flush: async (_ownerId, reason) => {
      reasons.push(reason);
      return { pending: reasons.length < 2 };
    },
    schedule: (fn, ms) => {
      delays.push(ms);
      retry.run = fn;
      return () => {
        retry.run = null;
      };
    },
  });
  sync.onOnline();
  await tick();
  assert.deepEqual(reasons, ['online']);
  assert.deepEqual(delays, [reconnectDelayMs(1)]);
  assert.ok((delays[0] ?? 99_000) <= 10_000);
  const fire = retry.run;
  if (fire) fire();
  await tick();
  assert.deepEqual(reasons, ['online', 'backoff']);
  assert.deepEqual(delays, [reconnectDelayMs(1)]);
});

test('going offline cancels the retry', async () => {
  const reasons: string[] = [];
  const scheduled: { run: (() => void) | null } = { run: null };
  const sync = createReconnectSync({
    ownerId: () => 'user-a',
    flush: async (_ownerId, reason) => {
      reasons.push(reason);
      return { pending: true };
    },
    schedule: (fn) => {
      scheduled.run = fn;
      return () => {
        scheduled.run = null;
      };
    },
  });
  sync.onOnline();
  await tick();
  assert.deepEqual(reasons, ['online']);
  const late = scheduled.run;
  sync.onOffline();
  assert.equal(scheduled.run, null);
  if (typeof late === 'function') late();
  await tick();
  assert.deepEqual(reasons, ['online']);
});

test('web listens for online and native listens to NetInfo', () => {
  let online = 0;
  let offline = 0;
  const handlers = {
    onOnline: () => {
      online += 1;
    },
    onOffline: () => {
      offline += 1;
    },
  };
  const listeners = new Map<string, () => void>();
  const stopWeb = subscribeOnline('web', handlers, {
    windowTarget: {
      navigator: { onLine: false },
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type) => listeners.delete(type),
    },
  });
  assert.equal(online, 0);
  listeners.get('online')?.();
  listeners.get('offline')?.();
  assert.equal(online, 1);
  assert.equal(offline, 1);
  stopWeb();
  assert.equal(listeners.size, 0);

  const already = subscribeOnline('web', handlers, {
    windowTarget: {
      navigator: { onLine: true },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  already();
  assert.equal(online, 2);

  const net = {
    listener: null as ((state: { isConnected: boolean | null }) => void) | null,
  };
  const stopNative = subscribeOnline('native', handlers, {
    netInfo: {
      addEventListener: (fn) => {
        net.listener = fn;
        return () => {
          net.listener = null;
        };
      },
    },
  });
  const hear = (isConnected: boolean) => {
    const listener = net.listener;
    if (listener) listener({ isConnected });
  };
  hear(false);
  hear(true);
  hear(true);
  assert.equal(online, 3);
  hear(false);
  assert.equal(offline, 2);
  hear(true);
  assert.equal(online, 4);
  stopNative();
  assert.equal(net.listener, null);

  const device = fs.readFileSync('lib/deviceOnline.ts', 'utf8');
  const signal = fs.readFileSync('lib/onlineSignal.ts', 'utf8');
  const layout = fs.readFileSync('app/_layout.tsx', 'utf8');
  const sync = fs.readFileSync('components/offline-queue-sync.tsx', 'utf8');
  assert.match(signal, /addEventListener\('online'/);
  assert.match(device, /NetInfo/);
  assert.match(device, /addNetworkStateListener/);
  assert.match(device, /Platform\.OS === 'web'/);
  assert.match(layout, /OfflineQueueSync/);
  assert.match(sync, /releaseRetry: reason === 'online'/);
  assert.match(fs.readFileSync('app/(app)/sites/[siteId]/snags/index.tsx', 'utf8'), /runExclusive\(/);
  assert.match(fs.readFileSync('app/(app)/sites/[siteId]/variations/index.tsx', 'utf8'), /runExclusive\(/);
});
