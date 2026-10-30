import {
  currentSheetId,
  replacedNoticePath,
  type SheetLink,
  type SiteSeenGap,
  type SiteSeenSummary,
  type UnseenDrawing,
} from '@/data/drawingSeen';
import { repo } from '@/data/index';
import {
  dismissNoticesForOpenedSheet,
  flushDrawingSeenQueue,
  getDrawingSeenQueue,
  noticesForOwner,
  ownedQueue,
  type QueuedSeen,
  type SeenNotice,
} from '@/lib/drawingSeenQueue';
import { runExclusive } from '@/lib/offlineFlush';
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

export async function openReplacedNotice(notice: { siteId: string; drawingId: string }): Promise<ReturnType<typeof replacedNoticePath> | null> {
  try {
    const drawings = await repo.listDrawings(notice.siteId);
    const sheetId = currentSheetId(drawings, notice.drawingId);
    if (!sheetId) return null;
    return replacedNoticePath(notice.siteId, sheetId);
  } catch {
    return null;
  }
}

export async function clearNoticesAfterOpen(ownerId: string, openedDrawingId: string): Promise<void> {
  const queue = getDrawingSeenQueue();
  const mine = noticesForOwner(await queue.listNotices(), ownerId);
  if (mine.length === 0) return;
  const siteIds = [...new Set(mine.map((notice) => notice.siteId))];
  const drawings: SheetLink[] = [];
  for (const siteId of siteIds) {
    try {
      drawings.push(...(await repo.listDrawings(siteId)));
    } catch {
      // A site that will not load does not keep the others from clearing.
    }
  }
  await dismissNoticesForOpenedSheet(queue, ownerId, openedDrawingId, drawings);
}

export async function flushQueuedDrawingSeen(ownerId: string): Promise<SeenNotice[]> {
  return runExclusive(() => flushDrawingSeenQueue(getDrawingSeenQueue(), drawingSeenIo(), ownerId));
}

export async function refreshDrawingSeen(
  manage: boolean,
  ownerId: string | null | undefined
): Promise<{
  unseen: UnseenDrawing[];
  gaps: SiteSeenGap[];
  queued: QueuedSeen[];
  notices: SeenNotice[];
}> {
  const queue = getDrawingSeenQueue();
  if (ownerId && (await deviceIsOnline())) {
    await flushQueuedDrawingSeen(ownerId).catch(() => undefined);
  }
  const unseen = await repo.listMyUnseenDrawings().catch(() => [] as UnseenDrawing[]);
  const gaps = manage ? await repo.managerDrawingGaps().catch(() => [] as SiteSeenGap[]) : [];
  const queued = ownedQueue(await queue.list(), ownerId);
  const notices = noticesForOwner(await queue.listNotices(), ownerId);
  return { unseen, gaps, queued, notices };
}

export async function loadSiteSeenSummary(siteId: string): Promise<SiteSeenSummary | null> {
  try {
    return await repo.siteDrawingSeen(siteId);
  } catch {
    return null;
  }
}
