import { isRetryableSnagFailure, snagFailureCode, snagFailureFrom } from '@/data/snagFailure';
import { createSaveGate, enqueueOnce } from '@/lib/offlineSave';

export { SAVED_ON_PHONE, deviceIsOnline } from '@/lib/variationQueue';
export { isRetryableSnagFailure, snagFailureCode } from '@/data/snagFailure';

export type QueuedPhoto = {
  id: string;
  contentType: string;
  bytes: Uint8Array;
};

export type QueuedSnagCreate = {
  kind: 'create';
  localId: string;
  ownerId: string;
  siteId: string;
  companyId: string;
  note: string;
  levelArea: string | null;
  tradeLabel: string;
  photos: QueuedPhoto[];
  raisedAt: string;
  serverSnagId?: string;
  uploadedPhotos?: Array<{ storagePath: string; contentType: string; fileSizeBytes: number }>;
  attempts?: number;
  retryAt?: string;
};

export type QueuedSnagFix = {
  kind: 'fix';
  localId: string;
  ownerId: string;
  siteId: string;
  companyId: string;
  snagId: string;
  photos: QueuedPhoto[];
  fixedAt: string;
  uploadedPhotos?: Array<{ storagePath: string; contentType: string; fileSizeBytes: number }>;
  attempts?: number;
  retryAt?: string;
};

export type QueuedSnagSign = {
  kind: 'sign';
  localId: string;
  ownerId: string;
  siteId: string;
  signedAt: string;
  mode: 'internal' | 'contractor';
  signerName?: string;
  signerRole?: string;
  signerCompany: string;
  signaturePng?: string;
  coveredIds: string[];
  outstandingIds: string[];
  attempts?: number;
  retryAt?: string;
};

export type QueuedSnag = QueuedSnagCreate | QueuedSnagFix | QueuedSnagSign;

export type SnagNotice = {
  id: string;
  ownerId: string;
  siteId: string;
  message: string;
  photos: QueuedPhoto[];
  /** Business or HTTP code. `snag_list_changed` must not be sent again. */
  code?: string;
  retryItem?: QueuedSnag;
  /** Kept for Sign again so the form can be filled without a new signature. */
  signMode?: 'internal' | 'contractor';
  signerName?: string;
  signerRole?: string;
  signerCompany?: string;
};

export type SnagQueueStore = {
  list(): Promise<QueuedSnag[]>;
  put(item: QueuedSnag): Promise<void>;
  remove(localId: string): Promise<void>;
  listNotices(): Promise<SnagNotice[]>;
  putNotice(notice: SnagNotice): Promise<void>;
  removeNotice(id: string): Promise<void>;
};

const QUEUE_KEY = 'sitepack.snag.queue';
const NOTICE_KEY = 'sitepack.snag.notices';
export const SNAG_QUEUE_PREFIX = 'sitepack.snag.';
const DB_NAME = 'sitepack-snags';

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000];
const MAX_SNAG_RETRY_DELAY_MS = 5 * 60 * 1000;

export function snagRetryDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1;
  return Math.min(RETRY_DELAYS_MS[index] ?? MAX_SNAG_RETRY_DELAY_MS, MAX_SNAG_RETRY_DELAY_MS);
}

export function rejectedSnagNotice(kind: QueuedSnag['kind'], code: string, fixStillSending = false): string {
  if (kind === 'sign' && code === 'snag_list_changed' && fixStillSending) {
    return "A fix you made is still sending. Wait until it's sent, then sign again.";
  }
  if (kind === 'sign' && code === 'snag_list_changed') {
    return 'The snag list changed before this sign-off was sent. Please sign again.';
  }
  if (kind === 'sign' && code === 'closed') return 'Nothing was left to sign off';
  if (kind === 'create') return 'This snag was not saved';
  if (kind === 'fix') return 'This fix was not saved';
  return 'This sign-off was not saved';
}

type KeyedStorage = {
  length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
};

export function isSnagQueueStorageKey(key: string): boolean {
  return key.startsWith(SNAG_QUEUE_PREFIX);
}

/** Drop every snag-queue key. Sign-out and owner change call this. */
export function removeSnagQueueKeys(storage: KeyedStorage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isSnagQueueStorageKey(key)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

function copyPhoto(photo: QueuedPhoto): QueuedPhoto {
  return { ...photo, bytes: new Uint8Array(photo.bytes) };
}

function copyItem(item: QueuedSnag): QueuedSnag {
  if (item.kind === 'sign') return { ...item };
  return { ...item, photos: item.photos.map(copyPhoto) };
}

function copyNotice(notice: SnagNotice): SnagNotice {
  return {
    ...notice,
    photos: notice.photos.map(copyPhoto),
    retryItem: notice.retryItem ? copyItem(notice.retryItem) : undefined,
  };
}

export function memorySnagQueue(): SnagQueueStore {
  const rows = new Map<string, QueuedSnag>();
  const notices = new Map<string, SnagNotice>();
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
      return [...notices.values()].map(copyNotice);
    },
    async putNotice(notice) {
      notices.set(notice.id, copyNotice(notice));
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

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type StoredPhoto = { id: string; contentType: string; base64: string };
type StoredSnag =
  | (Omit<QueuedSnagCreate, 'photos'> & { photos?: StoredPhoto[] })
  | (Omit<QueuedSnagFix, 'photos'> & { photos?: StoredPhoto[] })
  | QueuedSnagSign;
type StoredNotice = Omit<SnagNotice, 'photos' | 'retryItem'> & { photos?: StoredPhoto[]; retryItem?: StoredSnag };

function hasOwner(value: { ownerId?: unknown }): boolean {
  return typeof value.ownerId === 'string' && value.ownerId.length > 0;
}

function isQueued(value: StoredSnag): value is StoredSnag {
  if (!value || typeof value !== 'object' || !hasOwner(value)) return false;
  if (value.kind === 'sign') {
    return (
      typeof value.localId === 'string' &&
      typeof value.siteId === 'string' &&
      Array.isArray(value.coveredIds) &&
      Array.isArray(value.outstandingIds)
    );
  }
  return typeof value.localId === 'string' && typeof value.siteId === 'string' && Array.isArray(value.photos);
}

function decode(item: StoredSnag): QueuedSnag {
  if (item.kind === 'sign') return item;
  const photos = (item.photos ?? []).map((photo) => ({
    id: photo.id,
    contentType: photo.contentType,
    bytes: fromBase64(photo.base64),
  }));
  if (item.kind === 'fix') return { ...item, photos };
  return { ...item, kind: 'create', photos };
}

function encode(item: QueuedSnag): StoredSnag {
  if (item.kind === 'sign') return item;
  return {
    ...item,
    photos: item.photos.map((photo) => ({
      id: photo.id,
      contentType: photo.contentType,
      base64: toBase64(photo.bytes),
    })),
  };
}

function decodeNotice(item: StoredNotice): SnagNotice | null {
  if (!item || typeof item.id !== 'string' || !hasOwner(item) || typeof item.message !== 'string') return null;
  const retryItem = item.retryItem && isQueued(item.retryItem) ? decode(item.retryItem) : undefined;
  return {
    id: item.id,
    ownerId: item.ownerId,
    siteId: item.siteId,
    message: item.message,
    photos: (item.photos ?? []).map((photo) => ({
      id: photo.id,
      contentType: photo.contentType,
      bytes: fromBase64(photo.base64),
    })),
    code: typeof item.code === 'string' ? item.code : undefined,
    signMode: item.signMode === 'internal' || item.signMode === 'contractor' ? item.signMode : undefined,
    signerName: typeof item.signerName === 'string' ? item.signerName : undefined,
    signerRole: typeof item.signerRole === 'string' ? item.signerRole : undefined,
    signerCompany: typeof item.signerCompany === 'string' ? item.signerCompany : undefined,
    retryItem,
  };
}

function encodeNotice(notice: SnagNotice): StoredNotice {
  const { retryItem, ...rest } = notice;
  return {
    ...rest,
    photos: notice.photos.map((photo) => ({
      id: photo.id,
      contentType: photo.contentType,
      base64: toBase64(photo.bytes),
    })),
    retryItem: retryItem ? encode(retryItem) : undefined,
  };
}

export function storageSnagQueue(storage: MemoryStorage): SnagQueueStore {
  function read(): QueuedSnag[] {
    const raw = storage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredSnag[];
    const rows = parsed.filter(isQueued).map(decode);
    if (rows.length !== parsed.length) storage.setItem(QUEUE_KEY, JSON.stringify(rows.map(encode)));
    return rows;
  }

  function write(rows: QueuedSnag[]) {
    storage.setItem(QUEUE_KEY, JSON.stringify(rows.map(encode)));
  }

  function readNotices(): SnagNotice[] {
    const raw = storage.getItem(NOTICE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredNotice[];
    return parsed.map(decodeNotice).filter((notice): notice is SnagNotice => notice !== null);
  }

  function writeNotices(rows: SnagNotice[]) {
    storage.setItem(NOTICE_KEY, JSON.stringify(rows.map(encodeNotice)));
  }

  return {
    async list() {
      return read().map(copyItem);
    },
    async put(item) {
      const next = read().filter((row) => row.localId !== item.localId);
      next.push(item);
      write(next);
    },
    async remove(localId) {
      write(read().filter((row) => row.localId !== localId));
    },
    async listNotices() {
      return readNotices().map(copyNotice);
    },
    async putNotice(notice) {
      const next = readNotices().filter((row) => row.id !== notice.id);
      next.push(notice);
      writeNotices(next);
    },
    async removeNotice(id) {
      writeNotices(readNotices().filter((row) => row.id !== id));
    },
  };
}

type IdbRequest = {
  result?: unknown;
  error?: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

type SnagDatabase = {
  close(): void;
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options: { keyPath: string }): void;
  transaction(
    name: string,
    mode: 'readonly' | 'readwrite'
  ): {
    objectStore(name: string): {
      getAll(): IdbRequest;
      put(value: unknown): IdbRequest;
      delete(key: string): IdbRequest;
    };
  };
};

function wait(request: IdbRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let openDatabase: SnagDatabase | null = null;

function indexedDbQueue(): SnagQueueStore | null {
  const factory = (globalThis as { indexedDB?: { open: (name: string, version: number) => IdbRequest & { onupgradeneeded: (() => void) | null; result?: SnagDatabase } } })
    .indexedDB;
  if (!factory) return null;
  const opened = new Promise<SnagDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db) return;
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'localId' });
      if (!db.objectStoreNames.contains('notices')) db.createObjectStore('notices', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      openDatabase = request.result ?? null;
      if (openDatabase) resolve(openDatabase);
      else reject(new Error('indexedDB'));
    };
    request.onerror = () => reject(request.error);
  });

  function store(name: 'queue' | 'notices', mode: 'readonly' | 'readwrite') {
    return opened.then((db) => db.transaction(name, mode).objectStore(name));
  }

  return {
    async list() {
      const rows = ((await wait((await store('queue', 'readonly')).getAll())) as StoredSnag[]).filter(isQueued);
      return rows.map(decode).map(copyItem);
    },
    async put(item) {
      await wait((await store('queue', 'readwrite')).put(encode(item)));
    },
    async remove(localId) {
      await wait((await store('queue', 'readwrite')).delete(localId));
    },
    async listNotices() {
      const rows = (await wait((await store('notices', 'readonly')).getAll())) as StoredNotice[];
      return rows.map(decodeNotice).filter((notice): notice is SnagNotice => notice !== null).map(copyNotice);
    },
    async putNotice(notice) {
      await wait((await store('notices', 'readwrite')).put(encodeNotice(notice)));
    },
    async removeNotice(id) {
      await wait((await store('notices', 'readwrite')).delete(id));
    },
  };
}

/** Forget the snag database. The next sign-in opens an empty one. */
export function deleteSnagIndexedDb(): void {
  active = null;
  try {
    openDatabase?.close();
  } catch {
    // Already closed.
  }
  openDatabase = null;
  const factory = (globalThis as { indexedDB?: { deleteDatabase: (name: string) => void } }).indexedDB;
  try {
    factory?.deleteDatabase(DB_NAME);
  } catch {
    // Already gone.
  }
}

let active: SnagQueueStore | null = null;

export function getSnagQueue(): SnagQueueStore {
  if (!active) {
    active = indexedDbQueue() ?? (typeof localStorage !== 'undefined' ? storageSnagQueue(localStorage) : memorySnagQueue());
  }
  return active;
}

export function setSnagQueueForTests(store: SnagQueueStore | null) {
  active = store;
}

const snagSaveGate = createSaveGate();

export async function persistThenSendSnag(
  item: QueuedSnag,
  online: boolean,
  send: (item: QueuedSnag) => Promise<void>,
  queue: SnagQueueStore = getSnagQueue()
): Promise<'sent' | 'queued'> {
  return enqueueOnce(snagSaveGate, item, online, send, queue);
}

function dropUploadedPaths(item: QueuedSnag): QueuedSnag {
  if (item.kind === 'sign') return item;
  const next = { ...item };
  delete next.uploadedPhotos;
  return next;
}

function queuedAt(item: QueuedSnag): string {
  if (item.kind === 'create') return item.raisedAt;
  if (item.kind === 'fix') return item.fixedAt;
  return item.signedAt;
}

export function orderedSnagQueue(items: QueuedSnag[]): QueuedSnag[] {
  const rank = { create: 0, fix: 1, sign: 2 };
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return rank[a.kind] - rank[b.kind];
    return queuedAt(a) < queuedAt(b) ? -1 : queuedAt(a) > queuedAt(b) ? 1 : 0;
  });
}

export function noticesForOwner(notices: SnagNotice[], ownerId: string | null | undefined): SnagNotice[] {
  if (!ownerId) return [];
  return notices.filter((notice) => notice.ownerId === ownerId);
}

/** This person's queued snags. Another owner's rows, and a signed-out phone, stay out. */
export function ownedSnagQueue(items: QueuedSnag[], ownerId: string | null | undefined): QueuedSnag[] {
  if (!ownerId) return [];
  return items.filter((item) => item.ownerId === ownerId);
}

/** True when this snag is in a sign-off this person has queued. */
export function signOffQueuedForSnag(
  items: QueuedSnag[],
  ownerId: string | null | undefined,
  siteId: string,
  snagId: string
): boolean {
  return ownedSnagQueue(items, ownerId).some(
    (item) => item.kind === 'sign' && item.siteId === siteId && item.coveredIds.includes(snagId)
  );
}

export type SnagFlushResult = {
  notices: SnagNotice[];
  signInRequired: boolean;
};

function sessionExpired(err: unknown): boolean {
  const failure = snagFailureFrom(err);
  return failure.kind === 'http' && failure.status === 401;
}

/** Send this person's queue. Other people's items are dropped with no network call. */
export async function flushSnagQueue(
  queue: SnagQueueStore,
  send: (item: QueuedSnag) => Promise<void>,
  ownerId: string,
  nowMs: () => number = () => Date.now()
): Promise<SnagFlushResult> {
  const created: SnagNotice[] = [];
  let signInRequired = false;
  for (const notice of await queue.listNotices()) {
    if (notice.ownerId !== ownerId) await queue.removeNotice(notice.id);
  }
  if (!ownerId) return { notices: created, signInRequired };
  for (const item of orderedSnagQueue(await queue.list())) {
    if (item.ownerId !== ownerId) {
      await queue.remove(item.localId);
      continue;
    }
    const due = item.retryAt ? Date.parse(item.retryAt) : 0;
    if (Number.isFinite(due) && due > nowMs()) continue;
    try {
      await send(item);
      await queue.remove(item.localId);
    } catch (err) {
      const current = (await queue.list()).find((row) => row.localId === item.localId) ?? item;
      if (isRetryableSnagFailure(err)) {
        const attempts = (current.attempts ?? 0) + 1;
        await queue.put({ ...current, attempts, retryAt: new Date(nowMs() + snagRetryDelayMs(attempts)).toISOString() });
        if (sessionExpired(err)) signInRequired = true;
        continue;
      }
      const code = snagFailureCode(err);
      const retrySource = code === 'invalid_path' ? dropUploadedPaths(current) : current;
      const pending = await queue.list();
      const fixStillSending = pending.some((row) => row.ownerId === item.ownerId && row.siteId === item.siteId && row.kind === 'fix');
      const listChanged = code === 'snag_list_changed';
      const signed = retrySource.kind === 'sign' ? retrySource : null;
      const notice: SnagNotice = {
        id: `reject:${item.ownerId}:${item.localId}`,
        ownerId: item.ownerId,
        siteId: item.siteId,
        message: rejectedSnagNotice(item.kind, code, fixStillSending),
        photos: retrySource.kind === 'sign' ? [] : retrySource.photos.map(copyPhoto),
        code,
        signMode: signed?.mode,
        signerName: signed?.signerName,
        signerRole: signed?.signerRole,
        signerCompany: signed?.signerCompany,
        retryItem: listChanged ? undefined : copyItem({ ...retrySource, attempts: 0, retryAt: undefined }),
      };
      await queue.putNotice(notice);
      await queue.remove(item.localId);
      created.push(notice);
    }
  }
  return { notices: created, signInRequired };
}
