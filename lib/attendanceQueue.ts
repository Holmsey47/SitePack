import { rpcErrorCode } from '@/data/repo';
import { snagFailureFrom, type SnagFailure } from '@/data/snagFailure';

export const SAVED_ON_PHONE = 'Saved on phone, will send';

/** Wait this long, times the attempt count, before a failed tap is sent again. */
export const ATTENDANCE_BACKOFF_MS = 30_000;

/** Network and session retries never wait longer than this. */
export const ATTENDANCE_BACKOFF_MAX_MS = 5 * 60 * 1000;

export const SIGN_IN_AGAIN = 'Sign in again to send this.';

export function attendanceRetryDelayMs(attempts: number): number {
  const delay = ATTENDANCE_BACKOFF_MS * Math.max(attempts, 1);
  return Math.min(delay, ATTENDANCE_BACKOFF_MAX_MS);
}

export const ATTENDANCE_QUEUE_KEY = 'sitepack.attendance.queue';
export const ATTENDANCE_NOTICE_KEY = 'sitepack.attendance.notices';
export const ATTENDANCE_OWNER_KEY = 'sitepack.attendance.owner';

export type QueuedTap = {
  localId: string;
  userId: string;
  siteId: string;
  action: 'in' | 'out';
  deviceAt: string;
  attempts?: number;
  retryAt?: string;
  needsSignIn?: boolean;
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
  dismissNotice(id: string): Promise<void>;
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

export function refusedTapNotice(action: QueuedTap['action'], code: string, detail?: string): string {
  if (code === 'not_signed_in') return 'Sign out was not saved. You were already signed out.';
  if (code === 'already_signed_in') {
    return detail
      ? `Sign in was not saved. You are still signed in at ${detail}.`
      : 'Sign in was not saved. You are already signed in.';
  }
  if (action === 'out') return 'Sign out was not saved.';
  return 'Sign in was not saved.';
}

/**
 * Retry a dropped connection, a timeout, 408, 429, 5xx, and a 401 for this user.
 * Known business codes and other 4xx (validation) are permanent.
 * An unexpected error still retries.
 */
function knownBusiness(code: string): boolean {
  return rpcErrorCode(code) === code;
}

/** A 401 or an expired session. The tap stays queued and the screen asks them to sign in. */
export function isSessionAttendanceFailure(err: unknown): boolean {
  const failure = snagFailureFrom(err);
  if (failure.kind === 'http' && failure.status === 401) return true;
  const text = failure.kind === 'business' ? failure.code : failure.message;
  return /jwt expired/i.test(text) || text === 'session_expired' || text === 'PGRST301';
}

/** Network, timeout, 408, 429, 5xx, and a same-user 401 retry. Known business codes and other 4xx do not. */
export function isRetryableAttendanceFailure(err: unknown): boolean {
  if (isSessionAttendanceFailure(err)) return true;
  const failure = snagFailureFrom(err);
  if (failure.kind === 'network') return true;
  if (failure.kind === 'http') {
    return failure.status === 408 || failure.status === 429 || (failure.status >= 500 && failure.status <= 599);
  }
  return !knownBusiness(failure.code);
}

function queuedAgain(item: QueuedTap, err: unknown): QueuedTap {
  const attempts = (item.attempts ?? 0) + 1;
  return {
    ...item,
    attempts,
    retryAt: new Date(Date.now() + attendanceRetryDelayMs(attempts)).toISOString(),
    needsSignIn: isSessionAttendanceFailure(err),
  };
}

function failureOf(failure: SnagFailure): { code: string; detail?: string } {
  if (failure.kind === 'business') return { code: failure.code, detail: failure.detail };
  if (failure.kind === 'http') return { code: String(failure.status) };
  return { code: failure.message };
}

function shiftKey(item: QueuedTap): string {
  return `${item.userId}\n${item.siteId}`;
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
    typeof item.deviceAt === 'string' &&
    (item.attempts == null || typeof item.attempts === 'number') &&
    (item.retryAt == null || typeof item.retryAt === 'string') &&
    (item.needsSignIn == null || typeof item.needsSignIn === 'boolean')
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
    async dismissNotice(id) {
      notices.delete(id);
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
    async dismissNotice(id) {
      const next = readNotices(storage).filter((row) => row.id !== id);
      if (next.length === 0) storage.removeItem(ATTENDANCE_NOTICE_KEY);
      else storage.setItem(ATTENDANCE_NOTICE_KEY, JSON.stringify(next));
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

export async function rememberRefusedTap(
  queue: AttendanceQueueStore,
  item: QueuedTap,
  code: string,
  detail?: string
): Promise<AttendanceNotice> {
  const notice: AttendanceNotice = {
    id: `reject:${item.localId}`,
    userId: item.userId,
    siteId: item.siteId,
    message: refusedTapNotice(item.action, code, detail),
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
  const waiting = new Set<string>();
  for (const item of orderedTaps(await queue.list())) {
    if (item.userId !== userId) {
      await queue.remove(item.localId);
      continue;
    }
    const key = shiftKey(item);
    if (waiting.has(key)) continue;
    if (item.retryAt && Date.parse(item.retryAt) > Date.now()) {
      waiting.add(key);
      continue;
    }
    try {
      await send(item);
      await queue.remove(item.localId);
    } catch (err) {
      const failure = failureOf(snagFailureFrom(err));
      if (!isRetryableAttendanceFailure(err)) {
        created.push(await rememberRefusedTap(queue, item, failure.code, failure.detail));
        await queue.remove(item.localId);
        continue;
      }
      await queue.put(queuedAgain(item, err));
      waiting.add(key);
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
  const ahead = orderedTaps(await queue.list()).filter((row) => row.userId === item.userId && row.siteId === item.siteId);
  if (ahead[0]?.localId !== item.localId) return 'queued';
  try {
    await send(item);
    await queue.remove(item.localId);
    return 'sent';
  } catch (err) {
    const failure = failureOf(snagFailureFrom(err));
    if (!isRetryableAttendanceFailure(err)) {
      await rememberRefusedTap(queue, item, failure.code, failure.detail);
      await queue.remove(item.localId);
      return 'refused';
    }
    await queue.put(queuedAgain(item, err));
    return 'queued';
  }
}
