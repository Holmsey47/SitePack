import { getDrawingSeenQueue, ownedQueue, type DrawingSeenQueue } from '@/lib/drawingSeenQueue';
import { getSnagQueue, ownedSnagQueue, type SnagQueueStore } from '@/lib/snagQueue';
import { getVariationQueue, type VariationQueueStore } from '@/lib/variationQueue';

export type QueueStores = {
  snagQueue?: SnagQueueStore;
  variationQueue?: VariationQueueStore;
  seenQueue?: DrawingSeenQueue;
};

function storesOf(stores?: QueueStores) {
  return {
    snagQueue: stores?.snagQueue ?? getSnagQueue(),
    variationQueue: stores?.variationQueue ?? getVariationQueue(),
    seenQueue: stores?.seenQueue ?? getDrawingSeenQueue(),
  };
}

/** Snags, variations, and seen taps this person has not sent yet. */
export async function countUnsentForUser(ownerId: string | null | undefined, stores?: QueueStores): Promise<number> {
  if (!ownerId) return 0;
  const active = storesOf(stores);
  const snags = ownedSnagQueue(await active.snagQueue.list(), ownerId).length;
  const variations = (await active.variationQueue.list()).filter((item) => item.ownerUserId === ownerId).length;
  const seen = ownedQueue(await active.seenQueue.list(), ownerId).length;
  return snags + variations + seen;
}

/** Drop queued rows and notices that belong to this person. Another person's queue stays. */
export async function clearOwnedQueues(ownerId: string | null | undefined, stores?: QueueStores): Promise<void> {
  if (!ownerId) return;
  const active = storesOf(stores);
  for (const item of await active.snagQueue.list()) {
    if (item.ownerId === ownerId) await active.snagQueue.remove(item.localId);
  }
  for (const notice of await active.snagQueue.listNotices()) {
    if (notice.ownerId === ownerId) await active.snagQueue.removeNotice(notice.id);
  }
  for (const item of await active.variationQueue.list()) {
    if (item.ownerUserId === ownerId) await active.variationQueue.remove(item.localId);
  }
  for (const item of await active.seenQueue.list()) {
    if (item.ownerId === ownerId) await active.seenQueue.remove(item.id);
  }
  for (const notice of await active.seenQueue.listNotices()) {
    if (notice.ownerId === ownerId) await active.seenQueue.removeNotice(notice.id);
  }
}

export function signOutConfirmCopy(unsent: boolean): { title: string; body: string } {
  return {
    title: 'Sign out of SitePack?',
    body: unsent
      ? 'This phone only. Items that have not been sent will be dropped. Other phones stay signed in.'
      : 'This phone only. Other phones stay signed in.',
  };
}
