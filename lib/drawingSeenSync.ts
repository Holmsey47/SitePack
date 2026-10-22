import { repo } from '@/data/index';
import type { SiteSeenGap, SiteSeenSummary, UnseenDrawing } from '@/data/drawingSeen';
import {
  flushDrawingSeenQueue,
  getDrawingSeenQueue,
  type QueuedSeen,
} from '@/lib/drawingSeenQueue';
import { deviceIsOnline } from '@/lib/variationQueue';

export async function refreshDrawingSeen(manage: boolean): Promise<{
  unseen: UnseenDrawing[];
  gaps: SiteSeenGap[];
  queued: QueuedSeen[];
}> {
  const queue = getDrawingSeenQueue();
  if (await deviceIsOnline()) {
    await flushDrawingSeenQueue(queue, {
      recordOpen: (drawingId) => repo.recordDrawingOpen(drawingId),
      confirm: (drawingId) => repo.confirmDrawingSeen(drawingId),
    }).catch(() => undefined);
  }
  const unseen = await repo.listMyUnseenDrawings().catch(() => [] as UnseenDrawing[]);
  const gaps = manage ? await repo.managerDrawingGaps().catch(() => [] as SiteSeenGap[]) : [];
  const queued = await queue.list();
  return { unseen, gaps, queued };
}

export async function loadSiteSeenSummary(siteId: string): Promise<SiteSeenSummary | null> {
  try {
    return await repo.siteDrawingSeen(siteId);
  } catch {
    return null;
  }
}
