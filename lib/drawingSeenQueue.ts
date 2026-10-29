import { currentSheetId } from '@/data/drawingSeen';
import { usableLocalStorage } from '@/lib/hostStorage';

export const SAVED_ON_PHONE = 'Saved on phone, will send';

export type QueuedSeen = {
  id: string;
  ownerId: string;
  kind: 'open' | 'confirm';
  drawingId: string;
  siteId: string;
  revision: string;
  at: string;
};

export type SeenNotice = {
  id: string;
  ownerId: string;
  siteId: string;
  drawingId: string;
  revision: string;
  message: string;
};

export type DrawingSeenQueue = {
  list(): Promise<QueuedSeen[]>;
  put(item: QueuedSeen): Promise<void>;
  remove(id: string): Promise<void>;
  listNotices(): Promise<SeenNotice[]>;
  putNotice(notice: SeenNotice): Promise<void>;
  removeNotice(id: string): Promise<void>;
};

const QUEUE_KEY = 'sitepack.drawingSeen.queue';
const NOTICE_KEY = 'sitepack.drawingSeen.notices';
export const DRAWING_SEEN_PREFIX = 'sitepack.drawingSeen.';

export function isDrawingSeenStorageKey(key: string): boolean {
  return key.startsWith(DRAWING_SEEN_PREFIX);
}

type KeyedStorage = {
  length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
};

/** Drop every seen-queue key. The drawing-cache wipe calls this. */
export function removeDrawingSeenKeys(storage: KeyedStorage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isDrawingSeenStorageKey(key)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

export function memoryDrawingSeenQueue(): DrawingSeenQueue {
  const rows = new Map<string, QueuedSeen>();
  const notices = new Map<string, SeenNotice>();
  return {
    async list() {
      return [...rows.values()].map((item) => ({ ...item }));
    },
    async put(item) {
      rows.set(item.id, { ...item });
    },
    async remove(id) {
      rows.delete(id);
    },
    async listNotices() {
      return [...notices.values()].map((notice) => ({ ...notice }));
    },
    async putNotice(notice) {
      notices.set(notice.id, { ...notice });
    },
    async removeNotice(id) {
      notices.delete(id);
    },
  };
}

type MemoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function isQueuedSeen(value: unknown): value is QueuedSeen {
  if (!value || typeof value !== 'object') return false;
  const item = value as QueuedSeen;
  return (
    typeof item.id === 'string' &&
    (item.kind === 'open' || item.kind === 'confirm') &&
    typeof item.drawingId === 'string' &&
    typeof item.siteId === 'string' &&
    typeof item.revision === 'string' &&
    typeof item.at === 'string' &&
    typeof item.ownerId === 'string' &&
    item.ownerId.length > 0
  );
}

function isSeenNotice(value: unknown): value is SeenNotice {
  if (!value || typeof value !== 'object') return false;
  const notice = value as SeenNotice;
  return (
    typeof notice.id === 'string' &&
    typeof notice.siteId === 'string' &&
    typeof notice.drawingId === 'string' &&
    typeof notice.revision === 'string' &&
    typeof notice.message === 'string' &&
    typeof notice.ownerId === 'string' &&
    notice.ownerId.length > 0
  );
}

function readNotices(storage: MemoryStorage): SeenNotice[] {
  const raw = storage.getItem(NOTICE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isSeenNotice).map((notice) => ({ ...notice }));
}

export function storageDrawingSeenQueue(storage: MemoryStorage): DrawingSeenQueue {
  return {
    async list() {
      const raw = storage.getItem(QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isQueuedSeen).map((item) => ({ ...item }));
    },
    async put(item) {
      const current = JSON.parse(storage.getItem(QUEUE_KEY) ?? '[]') as unknown[];
      const next = current.filter((row) => !isQueuedSeen(row) || row.id !== item.id);
      next.push(item);
      storage.setItem(QUEUE_KEY, JSON.stringify(next.filter(isQueuedSeen)));
    },
    async remove(id) {
      const current = JSON.parse(storage.getItem(QUEUE_KEY) ?? '[]') as unknown[];
      storage.setItem(QUEUE_KEY, JSON.stringify(current.filter((row) => !isQueuedSeen(row) || row.id !== id)));
    },
    async listNotices() {
      return readNotices(storage);
    },
    async putNotice(notice) {
      const next = readNotices(storage).filter((row) => row.id !== notice.id);
      next.push(notice);
      storage.setItem(NOTICE_KEY, JSON.stringify(next));
    },
    async removeNotice(id) {
      const next = readNotices(storage).filter((row) => row.id !== id);
      storage.setItem(NOTICE_KEY, JSON.stringify(next));
    },
  };
}

let active: DrawingSeenQueue | null = null;

export function getDrawingSeenQueue(): DrawingSeenQueue {
  if (!active) {
    const stored = usableLocalStorage();
    active = stored ? storageDrawingSeenQueue(stored) : memoryDrawingSeenQueue();
  }
  return active;
}

export function setDrawingSeenQueueForTests(store: DrawingSeenQueue | null) {
  active = store;
}

export function queueId(kind: QueuedSeen['kind'], drawingId: string, revision: string, ownerId: string): string {
  return `${ownerId}:${kind}:${drawingId}:${revision}`;
}

export function ownedQueue(rows: QueuedSeen[], ownerId: string | null | undefined): QueuedSeen[] {
  if (!ownerId) return [];
  return rows.filter((row) => row.ownerId === ownerId);
}

export async function dismissNoticesForOpenedSheet(
  queue: DrawingSeenQueue,
  ownerId: string,
  openedDrawingId: string,
  drawings: { id: string; supersedes_id: string | null; is_current: boolean }[]
): Promise<void> {
  for (const notice of await queue.listNotices()) {
    if (notice.ownerId !== ownerId) continue;
    if (currentSheetId(drawings, notice.drawingId) === openedDrawingId) {
      await queue.removeNotice(notice.id);
    }
  }
}

export function noticesForOwner(notices: SeenNotice[], ownerId: string | null | undefined): SeenNotice[] {
  if (!ownerId) return [];
  return notices.filter((notice) => notice.ownerId === ownerId);
}

/** Opens go first so a queued tap can confirm after the open lands. */
export function orderedQueue(items: QueuedSeen[]): QueuedSeen[] {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'open' ? -1 : 1;
    return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
  });
}

const DROP = new Set(['not_current', 'not_authorized', 'drawing_not_found']);

export function isDroppedSeenCode(code: string): boolean {
  return DROP.has(code);
}

function errorCode(err: unknown): string {
  return err instanceof Error ? err.message : '';
}

/** Short line for a queued tap the server refused. */
export function rejectedTapNotice(revision: string, code: string, currentRevision?: string | null): string {
  if (code === 'not_current') {
    if (currentRevision && currentRevision !== revision) {
      return `Rev ${revision} was replaced — open rev ${currentRevision}`;
    }
    return `Rev ${revision} was replaced — open the current sheet`;
  }
  return `Rev ${revision} was not saved`;
}

export async function rememberRejectedTap(
  queue: DrawingSeenQueue,
  input: {
    ownerId: string;
    drawingId: string;
    siteId: string;
    revision: string;
    code: string;
    currentRevision?: string | null;
  }
): Promise<SeenNotice> {
  const notice: SeenNotice = {
    id: `reject:${input.ownerId}:${input.drawingId}:${input.revision}`,
    ownerId: input.ownerId,
    siteId: input.siteId,
    drawingId: input.drawingId,
    revision: input.revision,
    message: rejectedTapNotice(input.revision, input.code, input.currentRevision),
  };
  await queue.putNotice(notice);
  return notice;
}

async function rejectQueuedTap(
  queue: DrawingSeenQueue,
  item: QueuedSeen,
  code: string,
  currentRevision: ((item: QueuedSeen) => Promise<string | null>) | undefined,
  created: SeenNotice[]
): Promise<void> {
  if (item.kind === 'confirm') {
    let nextRevision: string | null = null;
    if (code === 'not_current' && currentRevision) {
      try {
        nextRevision = await currentRevision(item);
      } catch {
        nextRevision = null;
      }
    }
    created.push(
      await rememberRejectedTap(queue, {
        ownerId: item.ownerId,
        drawingId: item.drawingId,
        siteId: item.siteId,
        revision: item.revision,
        code,
        currentRevision: nextRevision,
      })
    );
  }
  await queue.remove(item.id);
}

export async function flushDrawingSeenQueue(
  queue: DrawingSeenQueue,
  io: {
    recordOpen(drawingId: string): Promise<unknown>;
    confirm(drawingId: string, seenAt: string): Promise<unknown>;
    currentRevision?(item: QueuedSeen): Promise<string | null>;
  },
  ownerId: string
): Promise<SeenNotice[]> {
  const created: SeenNotice[] = [];
  for (const notice of await queue.listNotices()) {
    if (notice.ownerId !== ownerId) await queue.removeNotice(notice.id);
  }
  const ordered = orderedQueue(await queue.list());
  for (const item of ordered) {
    if (item.ownerId !== ownerId) {
      await queue.remove(item.id);
      continue;
    }
    try {
      if (item.kind === 'open') await io.recordOpen(item.drawingId);
      else await io.confirm(item.drawingId, item.at);
      await queue.remove(item.id);
    } catch (err) {
      const code = errorCode(err);
      if (DROP.has(code)) {
        await rejectQueuedTap(queue, item, code, io.currentRevision, created);
        continue;
      }
      if (item.kind === 'confirm' && code === 'not_opened') {
        try {
          await io.recordOpen(item.drawingId);
          await io.confirm(item.drawingId, item.at);
          await queue.remove(item.id);
          continue;
        } catch (again) {
          const againCode = errorCode(again);
          if (DROP.has(againCode)) {
            await rejectQueuedTap(queue, item, againCode, io.currentRevision, created);
            continue;
          }
        }
      }
      return created;
    }
  }
  return created;
}

/**
 * Offline tap. Refuses when this phone has not opened the current rev.
 * The open is queued with the tap so sync can send them in order.
 */
export async function queueSeenTap(
  queue: DrawingSeenQueue,
  input: { ownerId: string; drawingId: string; siteId: string; revision: string; at: string; opened: boolean }
): Promise<'queued' | 'not_opened'> {
  if (!input.opened || !input.ownerId) return 'not_opened';
  await queue.put({
    id: queueId('open', input.drawingId, input.revision, input.ownerId),
    ownerId: input.ownerId,
    kind: 'open',
    drawingId: input.drawingId,
    siteId: input.siteId,
    revision: input.revision,
    at: input.at,
  });
  await queue.put({
    id: queueId('confirm', input.drawingId, input.revision, input.ownerId),
    ownerId: input.ownerId,
    kind: 'confirm',
    drawingId: input.drawingId,
    siteId: input.siteId,
    revision: input.revision,
    at: input.at,
  });
  return 'queued';
}

export function confirmQueued(queued: QueuedSeen[], drawingId: string, revision: string): boolean {
  return queued.some((item) => item.kind === 'confirm' && item.drawingId === drawingId && item.revision === revision);
}
