export const SAVED_ON_PHONE = 'Saved on phone, will send';

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
};

export type TalkNotice = {
  id: string;
  userId: string;
  siteId: string;
  message: string;
};

export type TalkQueueStore = {
  list(): Promise<QueuedTalk[]>;
  put(item: QueuedTalk): Promise<void>;
  remove(localId: string): Promise<void>;
  listNotices(): Promise<TalkNotice[]>;
  putNotice(notice: TalkNotice): Promise<void>;
  wipe(): Promise<void>;
};

type MemoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const DROP = new Set([
  'not_authorized',
  'invalid_input',
  'invalid_path',
  'invalid_time',
  'already_signed',
  'not_required',
  'version_locked',
]);

export function isDroppedTalkCode(code: string): boolean {
  return DROP.has(code);
}

export function refusedTalkNotice(action: QueuedTalkAction): string {
  if (action === 'question') return 'That question was not saved.';
  if (action === 'note') return 'That note was not saved.';
  return 'That signature was not saved.';
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
    typeof item.sessionId === 'string'
  );
}

function isNotice(value: unknown): value is TalkNotice {
  if (!value || typeof value !== 'object') return false;
  const notice = value as TalkNotice;
  return (
    typeof notice.id === 'string' &&
    typeof notice.userId === 'string' &&
    typeof notice.siteId === 'string' &&
    typeof notice.message === 'string'
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

function errorCode(err: unknown): string {
  return err instanceof Error ? err.message : '';
}

export async function rememberRefusedTalk(
  queue: TalkQueueStore,
  item: QueuedTalk,
  code: string
): Promise<TalkNotice> {
  void code;
  const notice: TalkNotice = {
    id: `reject:${item.localId}`,
    userId: item.userId,
    siteId: item.siteId,
    message: refusedTalkNotice(item.action),
  };
  await queue.putNotice(notice);
  return notice;
}

/**
 * Send only this login's items. Another login's items are dropped here,
 * with no call to send. A shared-device signature is owned by the logged-in user.
 */
export async function flushTalkQueue(
  queue: TalkQueueStore,
  userId: string,
  send: (item: QueuedTalk) => Promise<void>
): Promise<TalkNotice[]> {
  const created: TalkNotice[] = [];
  for (const item of orderedTalks(await queue.list())) {
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
        created.push(await rememberRefusedTalk(queue, item, code));
        await queue.remove(item.localId);
        continue;
      }
      return created;
    }
  }
  return created;
}

export async function persistThenSendTalk(
  item: QueuedTalk,
  online: boolean,
  send: (item: QueuedTalk) => Promise<void>,
  queue: TalkQueueStore = getTalkQueue()
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
      await rememberRefusedTalk(queue, item, code);
      await queue.remove(item.localId);
      return 'refused';
    }
    return 'queued';
  }
}
