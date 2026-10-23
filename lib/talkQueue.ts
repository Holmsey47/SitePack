import { rpcErrorCode } from '@/data/repo';
import { isRetryableSnagFailure, snagFailureFrom } from '@/data/snagFailure';
import { MAX_SNAG_RETRY_DELAY_MS } from '@/lib/snagQueue';

export const SAVED_ON_PHONE = 'Saved on phone, will send';
export const SESSION_ENDED = 'Your session has ended. Sign in again.';
export const SIGN_IN_AGAIN = 'Sign in again to send what is saved on this phone';
export const TALK_BACKOFF_MAX_MS = MAX_SNAG_RETRY_DELAY_MS;

export const TALK_QUEUE_KEY = 'sitepack.talks.queue';
export const TALK_NOTICE_KEY = 'sitepack.talks.notices';
export const TALK_OWNER_KEY = 'sitepack.talks.owner';

export type QueuedTalkAction = 'sign' | 'question' | 'presenter' | 'note';

export type QueuedTalk = {
  localId: string;
  userId: string;
  siteId: string;
  talkId: string;
  versionId: string;
  signerPersonId: string;
  action: QueuedTalkAction;
  signaturePng: string | null;
  question: string | null;
  explainedVerbally: boolean;
  interpreterUsed: boolean;
  deviceAt: string;
  sessionId: string;
  attempts?: number;
  nextAttemptAt?: string | null;
  needsSignIn?: boolean;
};

export type TalkNotice = {
  id: string;
  userId: string;
  siteId: string;
  talkId: string;
  message: string;
  /** Set when the signature, question, or note is still queued and can be sent again. */
  retryLocalId: string | null;
};

export type TalkSendResult = 'sent' | 'queued' | 'refused' | 'rejected';

export type TalkFailure =
  | { kind: 'network' }
  | { kind: 'http'; status: number }
  | { kind: 'signin' }
  | { kind: 'duplicate' }
  | { kind: 'auth' }
  | { kind: 'permanent'; code: string };

export type TalkQueueStore = {
  list(): Promise<QueuedTalk[]>;
  put(item: QueuedTalk): Promise<void>;
  remove(localId: string): Promise<void>;
  listNotices(): Promise<TalkNotice[]>;
  putNotice(notice: TalkNotice): Promise<void>;
  removeNotice(id: string): Promise<void>;
  wipe(): Promise<void>;
};

type MemoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const PERMANENT = new Set([
  'not_authorized',
  'invalid_input',
  'invalid_path',
  'invalid_time',
  'already_signed',
  'not_required',
  'version_locked',
  'unknown',
]);

export function talkBackoffMs(attempt: number): number {
  const step = Math.max(attempt, 1);
  const delay = 1000 * 2 ** Math.min(step - 1, 20);
  return Math.min(delay, TALK_BACKOFF_MAX_MS);
}

/** This login's notices. A missing user sees none. */
export function noticesForUser(notices: TalkNotice[], userId: string | null | undefined): TalkNotice[] {
  if (!userId) return [];
  return notices.filter((notice) => notice.userId === userId);
}

/** This login's queued items. A missing user sees none. */
export function pendingTalksForUser(items: QueuedTalk[], userId: string | null | undefined): QueuedTalk[] {
  if (!userId) return [];
  return items.filter((item) => item.userId === userId);
}

export function isDroppedTalkCode(code: string): boolean {
  return PERMANENT.has(code);
}

export function refusedTalkNotice(action: QueuedTalkAction, code = ''): string {
  if (code === 'version_locked') return 'This talk has a new version. Read it and sign again.';
  if (code === 'already_signed') return 'This version is already signed.';
  if (code === 'not_required') return 'This person does not need to sign this talk.';
  if (code === 'invalid_time') return 'The time on this phone is not valid. Check the clock and try again.';
  if (code === '400') {
    if (action === 'question') return 'That question was not saved.';
    if (action === 'note') return 'That note was not saved.';
    return 'That signature was not saved.';
  }
  if (code === 'invalid_input' || code === 'invalid_path') return 'Check the details and try again.';
  if (code === 'not_authorized') {
    if (action === 'question') return 'That question was not saved. Ask the site manager.';
    if (action === 'note') return 'That note was not saved. Ask the site manager.';
    return 'That signature was not saved. Ask the site manager.';
  }
  if (action === 'question') return 'That question was not saved. Try again.';
  if (action === 'note') return 'That note was not saved. Try again.';
  return 'That signature was not saved. Try again.';
}

export function keptTalkMessage(action: QueuedTalkAction): string {
  if (action === 'question') return 'That question is still on this phone. Try again when you have a signal.';
  if (action === 'note') return 'That note is still on this phone. Try again when you have a signal.';
  return 'That signature is still on this phone. Try again when you have a signal.';
}

function copyItem(item: QueuedTalk): QueuedTalk {
  return { ...item };
}

function isItem(value: unknown): value is QueuedTalk {
  if (!value || typeof value !== 'object') return false;
  const item = value as QueuedTalk;
  return (
    typeof item.localId === 'string' &&
    typeof item.userId === 'string' &&
    typeof item.siteId === 'string' &&
    typeof item.talkId === 'string' &&
    typeof item.versionId === 'string' &&
    typeof item.signerPersonId === 'string' &&
    (item.action === 'sign' || item.action === 'question' || item.action === 'presenter' || item.action === 'note') &&
    typeof item.deviceAt === 'string' &&
    typeof item.sessionId === 'string' &&
    (item.needsSignIn == null || typeof item.needsSignIn === 'boolean')
  );
}

function isNotice(value: unknown): value is TalkNotice {
  if (!value || typeof value !== 'object') return false;
  const notice = value as TalkNotice;
  return (
    typeof notice.id === 'string' &&
    typeof notice.userId === 'string' &&
    typeof notice.siteId === 'string' &&
    typeof notice.talkId === 'string' &&
    typeof notice.message === 'string' &&
    (notice.retryLocalId === null || typeof notice.retryLocalId === 'string')
  );
}

export function memoryTalkQueue(): TalkQueueStore {
  const rows = new Map<string, QueuedTalk>();
  const notices = new Map<string, TalkNotice>();
  return {
    async list() {
      return [...rows.values()].map(copyItem);
    },
    async put(item) {
      rows.set(item.localId, copyItem(item));
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
    async removeNotice(id) {
      notices.delete(id);
    },
    async wipe() {
      rows.clear();
      notices.clear();
    },
  };
}

function readItems(storage: MemoryStorage): QueuedTalk[] {
  const raw = storage.getItem(TALK_QUEUE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isItem).map(copyItem);
}

function readNotices(storage: MemoryStorage): TalkNotice[] {
  const raw = storage.getItem(TALK_NOTICE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isNotice).map((notice) => ({ ...notice }));
}

export function storageTalkQueue(storage: MemoryStorage): TalkQueueStore {
  return {
    async list() {
      return readItems(storage);
    },
    async put(item) {
      const next = readItems(storage).filter((row) => row.localId !== item.localId);
      next.push(copyItem(item));
      storage.setItem(TALK_QUEUE_KEY, JSON.stringify(next));
    },
    async remove(localId) {
      storage.setItem(TALK_QUEUE_KEY, JSON.stringify(readItems(storage).filter((row) => row.localId !== localId)));
    },
    async listNotices() {
      return readNotices(storage);
    },
    async putNotice(notice) {
      const next = readNotices(storage).filter((row) => row.id !== notice.id);
      next.push({ ...notice });
      storage.setItem(TALK_NOTICE_KEY, JSON.stringify(next));
    },
    async removeNotice(id) {
      storage.setItem(TALK_NOTICE_KEY, JSON.stringify(readNotices(storage).filter((row) => row.id !== id)));
    },
    async wipe() {
      storage.removeItem(TALK_QUEUE_KEY);
      storage.removeItem(TALK_NOTICE_KEY);
      storage.removeItem(TALK_OWNER_KEY);
    },
  };
}

let active: TalkQueueStore | null = null;

function browserStorage(): MemoryStorage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function getTalkQueue(): TalkQueueStore {
  if (!active) {
    const storage = browserStorage();
    active = storage ? storageTalkQueue(storage) : memoryTalkQueue();
  }
  return active;
}

export function setTalkQueueForTests(store: TalkQueueStore | null) {
  active = store;
}

export function readTalkOwner(storage: MemoryStorage | null = browserStorage()): string | null {
  const value = storage?.getItem(TALK_OWNER_KEY) ?? null;
  return value && value.length > 0 ? value : null;
}

export function writeTalkOwner(userId: string, storage: MemoryStorage | null = browserStorage()) {
  storage?.setItem(TALK_OWNER_KEY, userId);
}

/** Sign-out, a rejected session, or a different login drops every queued signature. */
export async function wipeTalkQueue(queue: TalkQueueStore = getTalkQueue()) {
  await queue.wipe();
  browserStorage()?.removeItem(TALK_OWNER_KEY);
}

/**
 * Keep the queue only when it already belongs to this login.
 * A missing or different owner wipes first, so the next flush cannot send it.
 */
export async function adoptTalkOwner(
  userId: string,
  queue: TalkQueueStore = getTalkQueue(),
  storage: MemoryStorage | null = browserStorage()
) {
  if (!userId) {
    await wipeTalkQueue(queue);
    return;
  }
  const previous = readTalkOwner(storage);
  if (previous === userId) return;
  await queue.wipe();
  writeTalkOwner(userId, storage);
}

export function orderedTalks(items: QueuedTalk[]): QueuedTalk[] {
  return [...items].sort((a, b) => {
    if (a.deviceAt !== b.deviceAt) return a.deviceAt < b.deviceAt ? -1 : 1;
    return a.localId < b.localId ? -1 : 1;
  });
}

function readMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return '';
}

function readCode(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function rawText(err: unknown): string {
  const message = readMessage(err);
  if (!err || typeof err !== 'object') return message;
  const details = (err as { details?: unknown }).details;
  return typeof details === 'string' && details ? `${message}\n${details}` : message;
}

/** A unique violation is already saved. Postgres puts 23505 on the error, not the HTTP status. */
function isDuplicateTalk(err: unknown): boolean {
  if (readCode(err) === '23505' || /duplicate key/i.test(rawText(err))) return true;
  const failure = snagFailureFrom(err);
  if (failure.kind !== 'business') return false;
  return failure.code === '23505' || /duplicate key/i.test(`${failure.code}\n${failure.detail ?? ''}`);
}

/**
 * A thrown session rejection with no HTTP status wipes the queue.
 * An HTTP 401 stays queued for this login.
 */
function isSessionRejected(err: unknown): boolean {
  const failure = snagFailureFrom(err);
  if (failure.kind === 'http') return false;
  if (/jwt expired/i.test(rawText(err)) || readCode(err) === 'PGRST301') return true;
  return failure.kind === 'business' && (failure.code === 'PGRST301' || /jwt expired/i.test(failure.code));
}

function isKnownBusiness(code: string): boolean {
  return rpcErrorCode(code) === code;
}

/**
 * Classify with the shared snag failure. Network, timeout, 408, 429, 5xx, and unknown errors stay queued.
 * A 401 is a sign-in prompt for this user. 23505 is already saved.
 */
export function classifyTalkFailure(err: unknown): TalkFailure {
  if (isDuplicateTalk(err)) return { kind: 'duplicate' };
  if (err instanceof Error && err.name === 'AbortError') return { kind: 'network' };
  const failure = snagFailureFrom(err);
  if (failure.kind === 'http' && failure.status === 401) return { kind: 'signin' };
  if (isSessionRejected(err)) return { kind: 'auth' };
  if (failure.kind === 'http' && isRetryableSnagFailure(err)) return { kind: 'http', status: failure.status };
  if (isRetryableSnagFailure(err)) return { kind: 'network' };
  if (failure.kind === 'http') return { kind: 'permanent', code: String(failure.status) };
  if (failure.kind === 'business' && !isKnownBusiness(failure.code)) return { kind: 'network' };
  if (failure.kind === 'business') return { kind: 'permanent', code: failure.code };
  return { kind: 'network' };
}

function groupKey(item: QueuedTalk): string {
  return `${item.signerPersonId}\n${item.talkId}`;
}

function waiting(item: QueuedTalk, now: number): boolean {
  if (!item.nextAttemptAt) return false;
  const at = Date.parse(item.nextAttemptAt);
  return Number.isFinite(at) && at > now;
}

export async function rememberRefusedTalk(queue: TalkQueueStore, item: QueuedTalk, code: string): Promise<TalkNotice> {
  await queue.removeNotice(`retry:${item.localId}`);
  const notice: TalkNotice = {
    id: `reject:${item.localId}`,
    userId: item.userId,
    siteId: item.siteId,
    talkId: item.talkId,
    message: refusedTalkNotice(item.action, code),
    retryLocalId: null,
  };
  await queue.putNotice(notice);
  return notice;
}

async function rememberKeptTalk(queue: TalkQueueStore, item: QueuedTalk, message = keptTalkMessage(item.action)): Promise<TalkNotice> {
  const notice: TalkNotice = {
    id: `retry:${item.localId}`,
    userId: item.userId,
    siteId: item.siteId,
    talkId: item.talkId,
    message,
    retryLocalId: item.localId,
  };
  await queue.putNotice(notice);
  return notice;
}

async function holdForRetry(queue: TalkQueueStore, item: QueuedTalk, now: number, message?: string): Promise<TalkNotice> {
  const attempts = (item.attempts ?? 0) + 1;
  await queue.put({
    ...item,
    attempts,
    needsSignIn: item.needsSignIn === true || message === SIGN_IN_AGAIN,
    nextAttemptAt: new Date(now + talkBackoffMs(attempts)).toISOString(),
  });
  return rememberKeptTalk(queue, item, message);
}

/**
 * Send only this login's items. Another login's items are dropped here,
 * with no call to send. A shared-device signature is owned by the logged-in user.
 * A retry waits only behind the same signer on the same talk.
 */
export async function flushTalkQueue(
  queue: TalkQueueStore,
  userId: string,
  send: (item: QueuedTalk) => Promise<void>,
  now = Date.now()
): Promise<TalkNotice[]> {
  const created: TalkNotice[] = [];
  const blocked = new Set<string>();
  for (const item of orderedTalks(await queue.list())) {
    if (item.userId !== userId) {
      await queue.remove(item.localId);
      await queue.removeNotice(`retry:${item.localId}`);
      continue;
    }
    const group = groupKey(item);
    if (blocked.has(group) || waiting(item, now)) {
      blocked.add(group);
      continue;
    }
    try {
      await send(item);
      await queue.remove(item.localId);
      await queue.removeNotice(`retry:${item.localId}`);
    } catch (err) {
      const failure = classifyTalkFailure(err);
      if (failure.kind === 'signin') {
        created.push(await holdForRetry(queue, { ...item, needsSignIn: true }, now, SIGN_IN_AGAIN));
        blocked.add(group);
        continue;
      }
      if (failure.kind === 'network' || failure.kind === 'http') {
        created.push(await holdForRetry(queue, item, now));
        blocked.add(group);
        continue;
      }
      if (failure.kind === 'duplicate') {
        await queue.remove(item.localId);
        await queue.removeNotice(`retry:${item.localId}`);
        continue;
      }
      if (failure.kind === 'auth') {
        await wipeTalkQueue(queue);
        return created;
      }
      created.push(await rememberRefusedTalk(queue, item, failure.code));
      await queue.remove(item.localId);
    }
  }
  return created;
}

export async function dismissTalkNotice(queue: TalkQueueStore, notice: TalkNotice) {
  await queue.removeNotice(notice.id);
  if (notice.retryLocalId) await queue.remove(notice.retryLocalId);
}

/** Clear the backoff so the next flush can send this signature again. */
export async function retryQueuedTalk(queue: TalkQueueStore, localId: string) {
  const item = (await queue.list()).find((row) => row.localId === localId);
  if (!item) return;
  await queue.put({ ...item, nextAttemptAt: null });
}

export async function persistThenSendTalk(
  item: QueuedTalk,
  online: boolean,
  send: (item: QueuedTalk) => Promise<void>,
  queue: TalkQueueStore = getTalkQueue(),
  now = Date.now()
): Promise<TalkSendResult> {
  await queue.put(item);
  if (!online) return 'queued';
  try {
    await send(item);
    await queue.remove(item.localId);
    await queue.removeNotice(`retry:${item.localId}`);
    return 'sent';
  } catch (err) {
    const failure = classifyTalkFailure(err);
    if (failure.kind === 'signin') {
      await holdForRetry(queue, { ...item, needsSignIn: true }, now, SIGN_IN_AGAIN);
      return 'queued';
    }
    if (failure.kind === 'network' || failure.kind === 'http') {
      await holdForRetry(queue, item, now);
      return 'queued';
    }
    if (failure.kind === 'duplicate') {
      await queue.remove(item.localId);
      await queue.removeNotice(`retry:${item.localId}`);
      return 'sent';
    }
    if (failure.kind === 'auth') {
      await wipeTalkQueue(queue);
      return 'rejected';
    }
    await rememberRefusedTalk(queue, item, failure.code);
    await queue.remove(item.localId);
    return 'refused';
  }
}
