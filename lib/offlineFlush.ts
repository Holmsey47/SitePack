import { flushDrawingSeenQueue, getDrawingSeenQueue, ownedQueue, type DrawingSeenQueue } from '@/lib/drawingSeenQueue';
import {
  flushSnagQueue,
  getSnagQueue,
  ownedSnagQueue,
  type QueuedSnag,
  type SnagQueueStore,
} from '@/lib/snagQueue';
import {
  flushVariationQueue,
  getVariationQueue,
  type QueuedVariation,
  type VariationQueueStore,
} from '@/lib/variationQueue';

/** First retry is 2s, so a failed send is tried again inside the 10s reconnect window. */
export const RECONNECT_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000] as const;

export function reconnectDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), RECONNECT_BACKOFF_MS.length) - 1;
  return RECONNECT_BACKOFF_MS[index] ?? RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1];
}

let chain: Promise<void> = Promise.resolve();

/** One flush at a time. A second caller waits, then sees whatever the first one already removed. */
export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export type SeenFlushIo = {
  recordOpen: (drawingId: string) => Promise<unknown>;
  confirm: (drawingId: string, seenAt: string) => Promise<unknown>;
};

export type OfflineFlushIo = {
  snagQueue: SnagQueueStore;
  variationQueue: VariationQueueStore;
  seenQueue: DrawingSeenQueue;
  sendSnag: (item: QueuedSnag) => Promise<void>;
  sendVariation: (item: QueuedVariation) => Promise<void>;
  seenIo: SeenFlushIo;
};

async function releaseSnagRetries(queue: SnagQueueStore, ownerId: string): Promise<void> {
  for (const item of await queue.list()) {
    if (item.ownerId !== ownerId || !item.retryAt) continue;
    const next = { ...item };
    delete next.retryAt;
    await queue.put(next);
  }
}

/**
 * Send this person's snags, variations, and seen taps.
 * The queued local id is the idempotency key. A second flush does not mint a new one.
 */
export async function flushOfflineQueues(
  ownerId: string,
  io: OfflineFlushIo,
  options?: { releaseRetry?: boolean }
): Promise<{ pending: boolean }> {
  if (!ownerId) return { pending: false };
  if (options?.releaseRetry) await releaseSnagRetries(io.snagQueue, ownerId);
  await flushSnagQueue(io.snagQueue, io.sendSnag, ownerId);
  const variations = (await io.variationQueue.list()).filter((item) => item.ownerUserId === ownerId);
  const siteIds = [...new Set(variations.map((item) => item.siteId))];
  for (const siteId of siteIds) {
    await flushVariationQueue(ownerId, siteId, true, io.sendVariation, io.variationQueue);
  }
  await flushDrawingSeenQueue(io.seenQueue, io.seenIo, ownerId);
  const snagsLeft = ownedSnagQueue(await io.snagQueue.list(), ownerId).length > 0;
  const variationsLeft = (await io.variationQueue.list()).some((item) => item.ownerUserId === ownerId);
  const seenLeft = ownedQueue(await io.seenQueue.list(), ownerId).length > 0;
  return { pending: snagsLeft || variationsLeft || seenLeft };
}

async function defaultIo(): Promise<OfflineFlushIo> {
  const { sendQueuedSnag } = await import('@/lib/sendQueuedSnag');
  const { sendQueuedVariation } = await import('@/lib/sendQueuedVariation');
  const { drawingSeenIo } = await import('@/lib/drawingSeenSync');
  const snagQueue = getSnagQueue();
  return {
    snagQueue,
    variationQueue: getVariationQueue(),
    seenQueue: getDrawingSeenQueue(),
    sendSnag: (item) => sendQueuedSnag(item, undefined, snagQueue),
    sendVariation: (item) => sendQueuedVariation(item),
    seenIo: drawingSeenIo(),
  };
}

export async function flushDeviceQueues(ownerId: string, options?: { releaseRetry?: boolean }): Promise<{ pending: boolean }> {
  return runExclusive(async () => flushOfflineQueues(ownerId, await defaultIo(), options));
}

export function createReconnectSync(deps: {
  ownerId: () => string | null;
  flush: (ownerId: string, reason: 'online' | 'backoff') => Promise<{ pending: boolean }>;
  schedule?: (fn: () => void, ms: number) => () => void;
}): { onOnline: () => void; onOffline: () => void; stop: () => void } {
  let cancel: (() => void) | null = null;
  let running = false;
  let queued = false;
  let attempt = 0;
  let stopped = false;
  let offline = false;
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    });

  function clearTimer() {
    cancel?.();
    cancel = null;
  }

  async function run(reason: 'online' | 'backoff'): Promise<void> {
    const ownerId = deps.ownerId();
    if (!ownerId || stopped || offline) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    let pending = false;
    try {
      pending = (await deps.flush(ownerId, reason)).pending;
    } catch {
      pending = true;
    } finally {
      running = false;
    }
    if (stopped || offline) return;
    if (queued) {
      queued = false;
      await run('online');
      return;
    }
    if (!pending) {
      attempt = 0;
      return;
    }
    attempt += 1;
    const delay = reconnectDelayMs(attempt);
    clearTimer();
    cancel = schedule(() => {
      cancel = null;
      void run('backoff');
    }, delay);
  }

  return {
    onOnline() {
      if (stopped) return;
      offline = false;
      attempt = 0;
      clearTimer();
      void run('online');
    },
    onOffline() {
      offline = true;
      attempt = 0;
      clearTimer();
    },
    stop() {
      stopped = true;
      clearTimer();
    },
  };
}
