export const SAVED_ON_PHONE = 'Saved on phone, will send';

export const ATTENDANCE_QUEUE_KEY = 'sitepack.attendance.queue';
export const ATTENDANCE_NOTICE_KEY = 'sitepack.attendance.notices';
export const ATTENDANCE_OWNER_KEY = 'sitepack.attendance.owner';

export type QueuedTap = {
  localId: string;
  userId: string;
  siteId: string;
  action: 'in' | 'out';
  deviceAt: string;
};

export type AttendanceNotice = {
  id: string;
  userId: string;
  siteId: string;
  message: string;
};

export type AttendanceQueueStore = {
  list(): Promise<QueuedTap[]>;
  put(item: QueuedTap): Promise<void>;
  remove(localId: string): Promise<void>;
  listNotices(): Promise<AttendanceNotice[]>;
  putNotice(notice: AttendanceNotice): Promise<void>;
  wipe(): Promise<void>;
};

type MemoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const DROP = new Set(['not_signed_in', 'already_signed_in', 'not_authorized', 'invalid_time', 'invalid_input']);

export function isDroppedAttendanceCode(code: string): boolean {
  return DROP.has(code);
}

export function refusedTapNotice(action: QueuedTap['action'], code: string): string {
  if (code === 'not_signed_in') return 'Sign out was not saved. You were already signed out.';
  if (code === 'already_signed_in') return 'Sign in was not saved. You are already signed in.';
  if (action === 'out') return 'Sign out was not saved.';
  return 'Sign in was not saved.';
}

function copyTap(item: QueuedTap): QueuedTap {
  return { ...item };
}

function isTap(value: unknown): value is QueuedTap {
  if (!value || typeof value !== 'object') return false;
  const item = value as QueuedTap;
  return (
    typeof item.localId === 'string' &&
    typeof item.userId === 'string' &&
    typeof item.siteId === 'string' &&
    (item.action === 'in' || item.action === 'out') &&
    typeof item.deviceAt === 'string'
  );
}

function isNotice(value: unknown): value is AttendanceNotice {
  if (!value || typeof value !== 'object') return false;
  const notice = value as AttendanceNotice;
  return (
    typeof notice.id === 'string' &&
    typeof notice.userId === 'string' &&
    typeof notice.siteId === 'string' &&
    typeof notice.message === 'string'
  );
}

export function memoryAttendanceQueue(): AttendanceQueueStore {
  const rows = new Map<string, QueuedTap>();
  const notices = new Map<string, AttendanceNotice>();
  return {
    async list() {
      return [...rows.values()].map(copyTap);
    },
    async put(item) {
      rows.set(item.localId, copyTap(item));
    },
    async remove(localId) {
      rows.delete(localId);
    },
    async listNotices() {
      return [...notices.values()].map((notice) => ({ ...notice }));
    },
    async putNotice(notice) {
      notices.set(notice.id, { ...notice });
    },
    async wipe() {
      rows.clear();
      notices.clear();
    },
  };
}

function readTaps(storage: MemoryStorage): QueuedTap[] {
  const raw = storage.getItem(ATTENDANCE_QUEUE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isTap).map(copyTap);
}

function readNotices(storage: MemoryStorage): AttendanceNotice[] {
  const raw = storage.getItem(ATTENDANCE_NOTICE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isNotice).map((notice) => ({ ...notice }));
}

export function storageAttendanceQueue(storage: MemoryStorage): AttendanceQueueStore {
  return {
    async list() {
      return readTaps(storage);
    },
    async put(item) {
      const next = readTaps(storage).filter((row) => row.localId !== item.localId);
      next.push(copyTap(item));
      storage.setItem(ATTENDANCE_QUEUE_KEY, JSON.stringify(next));
    },
    async remove(localId) {
      storage.setItem(ATTENDANCE_QUEUE_KEY, JSON.stringify(readTaps(storage).filter((row) => row.localId !== localId)));
    },
    async listNotices() {
      return readNotices(storage);
    },
    async putNotice(notice) {
      const next = readNotices(storage).filter((row) => row.id !== notice.id);
      next.push({ ...notice });
      storage.setItem(ATTENDANCE_NOTICE_KEY, JSON.stringify(next));
    },
    async wipe() {
      storage.removeItem(ATTENDANCE_QUEUE_KEY);
      storage.removeItem(ATTENDANCE_NOTICE_KEY);
      storage.removeItem(ATTENDANCE_OWNER_KEY);
    },
  };
}

let active: AttendanceQueueStore | null = null;

function browserStorage(): MemoryStorage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function getAttendanceQueue(): AttendanceQueueStore {
  if (!active) {
    const storage = browserStorage();
    active = storage ? storageAttendanceQueue(storage) : memoryAttendanceQueue();
  }
  return active;
}

export function setAttendanceQueueForTests(store: AttendanceQueueStore | null) {
  active = store;
}

export function readAttendanceOwner(storage: MemoryStorage | null = browserStorage()): string | null {
  const value = storage?.getItem(ATTENDANCE_OWNER_KEY) ?? null;
  return value && value.length > 0 ? value : null;
}

export function writeAttendanceOwner(userId: string, storage: MemoryStorage | null = browserStorage()) {
  storage?.setItem(ATTENDANCE_OWNER_KEY, userId);
}

/** Sign-out, a rejected session, or a different login drops every queued tap. */
export async function wipeAttendanceQueue(queue: AttendanceQueueStore = getAttendanceQueue()) {
  await queue.wipe();
  browserStorage()?.removeItem(ATTENDANCE_OWNER_KEY);
}

/**
 * Keep the queue only when it already belongs to this login.
 * A missing or different owner wipes first, so the next flush cannot send it.
 */
export async function adoptAttendanceOwner(
  userId: string,
  queue: AttendanceQueueStore = getAttendanceQueue(),
  storage: MemoryStorage | null = browserStorage()
) {
  if (!userId) {
    await wipeAttendanceQueue(queue);
    return;
  }
  const previous = readAttendanceOwner(storage);
  if (previous === userId) return;
  await queue.wipe();
  writeAttendanceOwner(userId, storage);
}

export function orderedTaps(items: QueuedTap[]): QueuedTap[] {
  return [...items].sort((a, b) => {
    if (a.deviceAt !== b.deviceAt) return a.deviceAt < b.deviceAt ? -1 : 1;
    if (a.action !== b.action) return a.action === 'in' ? -1 : 1;
    return a.localId < b.localId ? -1 : 1;
  });
}

export function stateAfterQueue(server: 'in' | 'out', queued: QueuedTap[]): 'in' | 'out' {
  let state = server;
  for (const item of orderedTaps(queued)) state = item.action === 'in' ? 'in' : 'out';
  return state;
}

function errorCode(err: unknown): string {
  return err instanceof Error ? err.message : '';
}

export async function rememberRefusedTap(
  queue: AttendanceQueueStore,
  item: QueuedTap,
  code: string
): Promise<AttendanceNotice> {
  const notice: AttendanceNotice = {
    id: `reject:${item.localId}`,
    userId: item.userId,
    siteId: item.siteId,
    message: refusedTapNotice(item.action, code),
  };
  await queue.putNotice(notice);
  return notice;
}

/**
 * Send only this login's taps. Another login's taps are dropped here,
 * with no call to send.
 */
export async function flushAttendanceQueue(
  queue: AttendanceQueueStore,
  userId: string,
  send: (item: QueuedTap) => Promise<void>
): Promise<AttendanceNotice[]> {
  const created: AttendanceNotice[] = [];
  for (const item of orderedTaps(await queue.list())) {
    if (item.userId !== userId) {
      await queue.remove(item.localId);
      continue;
    }
    try {
      await send(item);
      await queue.remove(item.localId);
    } catch (err) {
      const code = errorCode(err);
      if (DROP.has(code)) {
        created.push(await rememberRefusedTap(queue, item, code));
        await queue.remove(item.localId);
        continue;
      }
      return created;
    }
  }
  return created;
}

export async function persistThenSendAttendance(
  item: QueuedTap,
  online: boolean,
  send: (item: QueuedTap) => Promise<void>,
  queue: AttendanceQueueStore = getAttendanceQueue()
): Promise<'sent' | 'queued' | 'refused'> {
  await queue.put(item);
  if (!online) return 'queued';
  try {
    await send(item);
    await queue.remove(item.localId);
    return 'sent';
  } catch (err) {
    const code = errorCode(err);
    if (DROP.has(code)) {
      await rememberRefusedTap(queue, item, code);
      await queue.remove(item.localId);
      return 'refused';
    }
    return 'queued';
  }
}
