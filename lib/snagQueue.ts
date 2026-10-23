export { SAVED_ON_PHONE, deviceIsOnline } from '@/lib/variationQueue';

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
};

export type QueuedSnag = QueuedSnagCreate | QueuedSnagFix | QueuedSnagSign;

export type SnagNotice = {
  id: string;
  ownerId: string;
  siteId: string;
  message: string;
  photos: QueuedPhoto[];
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

const DROP = new Set(['not_authorized', 'not_found', 'closed', 'snag_locked']);

export function isDroppedSnagCode(code: string): boolean {
  return DROP.has(code);
}

export function rejectedSnagNotice(kind: QueuedSnag['kind'], code: string): string {
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
  return { ...notice, photos: notice.photos.map(copyPhoto) };
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
type StoredNotice = Omit<SnagNotice, 'photos'> & { photos?: StoredPhoto[] };

function hasOwner(value: { ownerId?: unknown }): boolean {
  return typeof value.ownerId === 'string' && value.ownerId.length > 0;
}

function isQueued(value: StoredSnag): value is StoredSnag {
  if (!value || typeof value !== 'object' || !hasOwner(value)) return false;
  if (value.kind === 'sign') return typeof value.localId === 'string' && typeof value.siteId === 'string';
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
  };
}

function encodeNotice(notice: SnagNotice): StoredNotice {
  return {
    ...notice,
    photos: notice.photos.map((photo) => ({
      id: photo.id,
      contentType: photo.contentType,
      base64: toBase64(photo.bytes),
    })),
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

export async function persistThenSendSnag(
  item: QueuedSnag,
  online: boolean,
  send: (item: QueuedSnag) => Promise<void>,
  queue: SnagQueueStore = getSnagQueue()
): Promise<'sent' | 'queued'> {
  await queue.put(item);
  if (!online) return 'queued';
  try {
    await send(item);
    await queue.remove(item.localId);
    return 'sent';
  } catch {
    return 'queued';
  }
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

/** Send this person's queue. Other people's items are dropped with no network call. */
export async function flushSnagQueue(
  queue: SnagQueueStore,
  send: (item: QueuedSnag) => Promise<void>,
  ownerId: string
): Promise<SnagNotice[]> {
  const created: SnagNotice[] = [];
  for (const notice of await queue.listNotices()) {
    if (notice.ownerId !== ownerId) await queue.removeNotice(notice.id);
  }
  if (!ownerId) return created;
  for (const item of orderedSnagQueue(await queue.list())) {
    if (item.ownerId !== ownerId) {
      await queue.remove(item.localId);
      continue;
    }
    try {
      await send(item);
      await queue.remove(item.localId);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (!DROP.has(code)) return created;
      const notice: SnagNotice = {
        id: `reject:${item.ownerId}:${item.localId}`,
        ownerId: item.ownerId,
        siteId: item.siteId,
        message: rejectedSnagNotice(item.kind, code),
        photos: item.kind === 'sign' ? [] : item.photos.map(copyPhoto),
      };
      await queue.putNotice(notice);
      await queue.remove(item.localId);
      created.push(notice);
    }
  }
  return created;
}
