import { repo } from '@/data/index';
import type { SiteSeenGap, SiteSeenSummary, UnseenDrawing } from '@/data/drawingSeen';
import {
  flushDrawingSeenQueue,
  getDrawingSeenQueue,
  type QueuedSeen,
  type SeenNotice,
} from '@/lib/drawingSeenQueue';
import { deviceIsOnline } from '@/lib/variationQueue';

export async function currentRevisionAfter(item: { drawingId: string; siteId: string }): Promise<string | null> {
  try {
    const drawings = await repo.listDrawings(item.siteId);
    let cursorId = item.drawingId;
    let current: string | null = null;
    for (let step = 0; step < 8; step += 1) {
      const next = drawings.find((row) => row.supersedes_id === cursorId);
      if (!next) break;
      cursorId = next.id;
      if (next.is_current) current = next.revision;
    }
    return current;
  } catch {
    return null;
  }
}

export function drawingSeenIo() {
  return {
    recordOpen: (drawingId: string) => repo.recordDrawingOpen(drawingId),
    confirm: (drawingId: string, seenAt: string) => repo.confirmDrawingSeen(drawingId, seenAt),
    currentRevision: (item: QueuedSeen) => currentRevisionAfter(item),
  };
}

export async function flushQueuedDrawingSeen(): Promise<SeenNotice[]> {
  return flushDrawingSeenQueue(getDrawingSeenQueue(), drawingSeenIo());
}

export async function refreshDrawingSeen(manage: boolean): Promise<{
  unseen: UnseenDrawing[];
  gaps: SiteSeenGap[];
  queued: QueuedSeen[];
  notices: SeenNotice[];
}> {
  const queue = getDrawingSeenQueue();
  if (await deviceIsOnline()) {
    await flushQueuedDrawingSeen().catch(() => undefined);
  }
  const unseen = await repo.listMyUnseenDrawings().catch(() => [] as UnseenDrawing[]);
  const gaps = manage ? await repo.managerDrawingGaps().catch(() => [] as SiteSeenGap[]) : [];
  const queued = await queue.list();
  const notices = await queue.listNotices();
  return { unseen, gaps, queued, notices };
}

export async function loadSiteSeenSummary(siteId: string): Promise<SiteSeenSummary | null> {
  try {
    return await repo.siteDrawingSeen(siteId);
  } catch {
    return null;
  }
}
