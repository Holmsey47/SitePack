import { rpcErrorCode } from '@/data/repo';
import { isRetryableSnagFailure, snagFailureFrom, type SnagFailure } from '@/data/snagFailure';
import { MAX_SNAG_RETRY_DELAY_MS } from '@/lib/snagQueue';

export const SAVED_ON_PHONE = 'Saved on phone, will send';

/** Wait this long, times the attempt count, before a failed tap is sent again. */
export const ATTENDANCE_BACKOFF_MS = 30_000;

/** Network, session, and unknown-error retries never wait longer than the shared cap. */
export const ATTENDANCE_BACKOFF_MAX_MS = MAX_SNAG_RETRY_DELAY_MS;

export const SIGN_IN_AGAIN = 'Sign in again to send this.';

export function attendanceRetryDelayMs(attempts: number): number {
  const delay = ATTENDANCE_BACKOFF_MS * Math.max(attempts, 1);
  return Math.min(delay, ATTENDANCE_BACKOFF_MAX_MS);
}

export const ATTENDANCE_QUEUE_KEY = 'sitepack.attendance.queue';
export const ATTENDANCE_NOTICE_KEY = 'sitepack.attendance.notices';
export const ATTENDANCE_OWNER_KEY = 'sitepack.attendance.owner';
export const ATTENDANCE_FORGOT_SEEN_KEY = 'sitepack.attendance.forgot-seen';

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
  /** Open site, when a sign-in was refused because they are still signed in there. */
  openSiteId?: string;
  openSiteName?: string;
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

const DROP = new Set([
  'not_signed_in',
  'already_signed_in',
  'not_authorized',
  'invalid_time',
  'invalid_input',
  'shift_too_long',
  'correction_overlaps',
]);

export function isDroppedAttendanceCode(code: string): boolean {
  return DROP.has(code);
}

export function refusedTapNotice(action: QueuedTap['action'], code: string, detail?: string): string {
  if (code === 'shift_too_long') return 'That shift is longer than 24 hours.';
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

/**
 * Same retry classes as a snag send, including a 401.
 * An unexpected error still retries. A known business code and any other 4xx do not.
 */
export function isRetryableAttendanceFailure(err: unknown): boolean {
  if (isSessionAttendanceFailure(err) || isRetryableSnagFailure(err)) return true;
  const failure = snagFailureFrom(err);
  if (failure.kind === 'http' || failure.kind === 'network') return false;
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

function failureOf(failure: SnagFailure): { code: string; detail?: string; hint?: string } {
  if (failure.kind === 'business') return { code: failure.code, detail: failure.detail, hint: failure.hint };
  if (failure.kind === 'http') return { code: String(failure.status) };
  return { code: failure.message };
}

const memoryForgotSeen = new Set<string>();

function readForgotRaw(storage: MemoryStorage): string[] {
  const raw = storage.getItem(ATTENDANCE_FORGOT_SEEN_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/** Entry ids this login has already been shown the next-morning notice for. */
export function forgotSeenIds(userId: string, storage: MemoryStorage | null = browserStorage()): Set<string> {
  if (!userId) return new Set();
  const prefix = `${userId}:`;
  const raw = storage ? readForgotRaw(storage) : [...memoryForgotSeen];
  return new Set(raw.filter((item) => item.startsWith(prefix)).map((item) => item.slice(prefix.length)));
}

export function markForgotSeen(userId: string, entryId: string, storage: MemoryStorage | null = browserStorage()) {
  if (!userId || !entryId) return;
  const id = `${userId}:${entryId}`;
  if (!storage) {
    memoryForgotSeen.add(id);
    return;
  }
  const next = readForgotRaw(storage);
  if (!next.includes(id)) next.push(id);
  storage.setItem(ATTENDANCE_FORGOT_SEEN_KEY, JSON.stringify(next));
}

function clearForgotSeen(storage: MemoryStorage | null) {
  memoryForgotSeen.clear();
  storage?.removeItem(ATTENDANCE_FORGOT_SEEN_KEY);
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
    typeof notice.message === 'string' &&
    (notice.openSiteId == null || typeof notice.openSiteId === 'string') &&
    (notice.openSiteName == null || typeof notice.openSiteName === 'string')
  );
}

function copyNotice(notice: AttendanceNotice): AttendanceNotice {
  const copy: AttendanceNotice = {
    id: notice.id,
    userId: notice.userId,
    siteId: notice.siteId,
    message: notice.message,
  };
  if (notice.openSiteId) copy.openSiteId = notice.openSiteId;
  if (notice.openSiteName) copy.openSiteName = notice.openSiteName;
  return copy;
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
      return [...notices.values()].map(copyNotice);
    },
    async putNotice(notice) {
      notices.set(notice.id, copyNotice(notice));
    },
    async dismissNotice(id) {
      notices.delete(id);
    },
    async wipe() {
      rows.clear();
      notices.clear();
      memoryForgotSeen.clear();
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
  return parsed.filter(isNotice).map(copyNotice);
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
      next.push(copyNotice(notice));
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
      clearForgotSeen(storage);
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
  clearForgotSeen(browserStorage());
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

/** Taps for this login on this site. A missing owner or a different user is hidden. */
export function pendingTapsForUser(
  taps: QueuedTap[],
  userId: string | null | undefined,
  siteId: string
): QueuedTap[] {
  if (!userId) return [];
  return taps.filter((item) => item.userId === userId && item.siteId === siteId);
}

/** Notices for this login on this site. A missing owner or a different user is hidden. */
export function noticesForUser(
  notices: AttendanceNotice[],
  userId: string | null | undefined,
  siteId: string
): AttendanceNotice[] {
  if (!userId) return [];
  return notices.filter((item) => item.userId === userId && item.siteId === siteId);
}

export function lateSignOutNotice(item: QueuedTap, message: string): AttendanceNotice {
  return {
    id: `late:${item.localId}`,
    userId: item.userId,
    siteId: item.siteId,
    message,
  };
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
  detail?: string,
  hint?: string
): Promise<AttendanceNotice> {
  const notice: AttendanceNotice = {
    id: `reject:${item.localId}`,
    userId: item.userId,
    siteId: item.siteId,
    message: refusedTapNotice(item.action, code, detail),
  };
  if (code === 'already_signed_in' && hint) {
    notice.openSiteId = hint;
    if (detail) notice.openSiteName = detail;
  }
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
        created.push(await rememberRefusedTap(queue, item, failure.code, failure.detail, failure.hint));
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
      await rememberRefusedTap(queue, item, failure.code, failure.detail, failure.hint);
      await queue.remove(item.localId);
      return 'refused';
    }
    await queue.put(queuedAgain(item, err));
    return 'queued';
  }
}
