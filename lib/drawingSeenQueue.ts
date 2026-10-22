export const SAVED_ON_PHONE = 'Saved on phone, will send';

export type QueuedSeen = {
  id: string;
  kind: 'open' | 'confirm';
  drawingId: string;
  siteId: string;
  revision: string;
  at: string;
};

export type DrawingSeenQueue = {
  list(): Promise<QueuedSeen[]>;
  put(item: QueuedSeen): Promise<void>;
  remove(id: string): Promise<void>;
};

const QUEUE_KEY = 'sitepack.drawingSeen.queue';

export function memoryDrawingSeenQueue(): DrawingSeenQueue {
  const rows = new Map<string, QueuedSeen>();
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
    typeof item.at === 'string'
  );
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
  };
}

let active: DrawingSeenQueue | null = null;

export function getDrawingSeenQueue(): DrawingSeenQueue {
  if (!active) {
    active =
      typeof localStorage !== 'undefined' ? storageDrawingSeenQueue(localStorage) : memoryDrawingSeenQueue();
  }
  return active;
}

export function setDrawingSeenQueueForTests(store: DrawingSeenQueue | null) {
  active = store;
}

export function queueId(kind: QueuedSeen['kind'], drawingId: string, revision: string): string {
  return `${kind}:${drawingId}:${revision}`;
}

/** Opens go first so a queued tap can confirm after the open lands. */
export function orderedQueue(items: QueuedSeen[]): QueuedSeen[] {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'open' ? -1 : 1;
    return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
  });
}

const DROP = new Set(['not_current', 'not_authorized', 'drawing_not_found']);

function errorCode(err: unknown): string {
  return err instanceof Error ? err.message : '';
}

export async function flushDrawingSeenQueue(
  queue: DrawingSeenQueue,
  io: {
    recordOpen(drawingId: string): Promise<unknown>;
    confirm(drawingId: string): Promise<unknown>;
  }
): Promise<void> {
  const ordered = orderedQueue(await queue.list());
  for (const item of ordered) {
    try {
      if (item.kind === 'open') await io.recordOpen(item.drawingId);
      else await io.confirm(item.drawingId);
      await queue.remove(item.id);
    } catch (err) {
      const code = errorCode(err);
      if (DROP.has(code)) {
        await queue.remove(item.id);
        continue;
      }
      if (item.kind === 'confirm' && code === 'not_opened') {
        try {
          await io.recordOpen(item.drawingId);
          await io.confirm(item.drawingId);
          await queue.remove(item.id);
          continue;
        } catch (again) {
          if (DROP.has(errorCode(again))) {
            await queue.remove(item.id);
            continue;
          }
        }
      }
      return;
    }
  }
}

/**
 * Offline tap. Refuses when this phone has not opened the current rev.
 * The open is queued with the tap so sync can send them in order.
 */
export async function queueSeenTap(
  queue: DrawingSeenQueue,
  input: { drawingId: string; siteId: string; revision: string; at: string; opened: boolean }
): Promise<'queued' | 'not_opened'> {
  if (!input.opened) return 'not_opened';
  await queue.put({
    id: queueId('open', input.drawingId, input.revision),
    kind: 'open',
    drawingId: input.drawingId,
    siteId: input.siteId,
    revision: input.revision,
    at: input.at,
  });
  await queue.put({
    id: queueId('confirm', input.drawingId, input.revision),
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
