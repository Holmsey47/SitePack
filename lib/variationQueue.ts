export const SAVED_ON_PHONE = 'Saved on phone, will send';

export type QueuedPhoto = {
  id: string;
  contentType: string;
  bytes: Uint8Array;
};

export type QueuedVariation = {
  localId: string;
  siteId: string;
  companyId: string;
  title: string;
  description: string;
  levelArea: string | null;
  quantityText: string | null;
  valuePence: number | null;
  photos: QueuedPhoto[];
  savedAt: string;
  ownerUserId: string;
  notice: string;
};

export type VariationQueueStore = {
  list(): Promise<QueuedVariation[]>;
  put(item: QueuedVariation): Promise<void>;
  remove(localId: string): Promise<void>;
};

function copyItem(item: QueuedVariation): QueuedVariation {
  return {
    ...item,
    photos: item.photos.map((photo) => ({
      ...photo,
      bytes: new Uint8Array(photo.bytes),
    })),
  };
}

export function memoryVariationQueue(): VariationQueueStore {
  const rows = new Map<string, QueuedVariation>();
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
  };
}

type MemoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key?(index: number): string | null;
  readonly length?: number;
  keys?(): string[];
};

export const VARIATION_QUEUE_PREFIX = 'sitepack.variation.queue.';
const LEGACY_QUEUE_KEY = 'sitepack.variation.queue';
const NOTICE_PREFIX = 'sitepack.variation.notice.';

function storageKeys(storage: MemoryStorage): string[] {
  if (storage.keys) return storage.keys();
  const keys: string[] = [];
  const length = storage.length ?? 0;
  for (let index = 0; index < length; index += 1) {
    const key = storage.key?.(index);
    if (key) keys.push(key);
  }
  return keys;
}

function isVariationQueueKey(key: string): boolean {
  return key === LEGACY_QUEUE_KEY || key.startsWith(VARIATION_QUEUE_PREFIX) || key.startsWith(NOTICE_PREFIX);
}

export function clearVariationQueueStorage(storage: MemoryStorage): void {
  for (const key of storageKeys(storage)) {
    if (isVariationQueueKey(key)) storage.removeItem(key);
  }
}

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

type StoredPhoto = Omit<QueuedPhoto, 'bytes'> & { base64: string };
type StoredVariation = Omit<QueuedVariation, 'photos'> & { photos: StoredPhoto[] };

function decodeItem(item: StoredVariation): QueuedVariation {
  return {
    ...item,
    ownerUserId: item.ownerUserId ?? '',
    notice: item.notice ?? '',
    photos: item.photos.map((photo) => ({
      id: photo.id,
      contentType: photo.contentType,
      bytes: fromBase64(photo.base64),
    })),
  };
}

function encodeItem(item: QueuedVariation): StoredVariation {
  return {
    ...item,
    photos: item.photos.map((photo) => ({
      id: photo.id,
      contentType: photo.contentType,
      base64: toBase64(photo.bytes),
    })),
  };
}

function readStored(storage: MemoryStorage, key: string): StoredVariation[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  return JSON.parse(raw) as StoredVariation[];
}

/** JSON storage. Each user's variations, photos and notice sit under that user's key. */
export function storageVariationQueue(storage: MemoryStorage): VariationQueueStore {
  function write(userId: string, rows: StoredVariation[]) {
    const key = `${VARIATION_QUEUE_PREFIX}${userId}`;
    if (rows.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(rows));
  }

  return {
    async list() {
      const rows: QueuedVariation[] = [];
      for (const key of storageKeys(storage)) {
        if (key !== LEGACY_QUEUE_KEY && !key.startsWith(VARIATION_QUEUE_PREFIX)) continue;
        rows.push(...readStored(storage, key).map(decodeItem));
      }
      return rows;
    },
    async put(item) {
      const key = `${VARIATION_QUEUE_PREFIX}${item.ownerUserId}`;
      const current = readStored(storage, key).filter((row) => row.localId !== item.localId);
      current.push(encodeItem(item));
      write(item.ownerUserId, current);
    },
    async remove(localId) {
      for (const key of storageKeys(storage)) {
        if (key !== LEGACY_QUEUE_KEY && !key.startsWith(VARIATION_QUEUE_PREFIX)) continue;
        const current = readStored(storage, key);
        const next = current.filter((row) => row.localId !== localId);
        if (next.length === current.length) continue;
        if (key === LEGACY_QUEUE_KEY) {
          if (next.length === 0) storage.removeItem(key);
          else storage.setItem(key, JSON.stringify(next));
        } else {
          write(key.slice(VARIATION_QUEUE_PREFIX.length), next);
        }
      }
    },
  };
}

let openDatabase: { close: () => void } | null = null;

type IdbRequest = {
  result?: unknown;
  error?: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

function wait(request: IdbRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function indexedDbQueue(): VariationQueueStore | null {
  const factory = (globalThis as { indexedDB?: { open: (name: string, version: number) => IdbRequest & { onupgradeneeded: (() => void) | null } } }).indexedDB;
  if (!factory) return null;
  const opened = new Promise<unknown>((resolve, reject) => {
    const request = factory.open('sitepack-variations', 1);
    request.onupgradeneeded = () => {
      const db = request.result as { objectStoreNames: { contains: (name: string) => boolean }; createObjectStore: (name: string, options: { keyPath: string }) => void };
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'localId' });
    };
    request.onsuccess = () => {
      openDatabase = request.result as { close: () => void };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });

  function store(mode: 'readonly' | 'readwrite') {
    return opened.then((db) => {
      const database = db as {
        transaction: (name: string, mode: 'readonly' | 'readwrite') => {
          objectStore: (name: string) => {
            getAll: () => IdbRequest;
            put: (value: unknown) => IdbRequest;
            delete: (key: string) => IdbRequest;
          };
        };
      };
      return database.transaction('queue', mode).objectStore('queue');
    });
  }

  return {
    async list() {
      const rows = (await wait((await store('readonly')).getAll())) as Array<
        Omit<QueuedVariation, 'photos'> & { photos: Array<Omit<QueuedPhoto, 'bytes'> & { base64: string }> }
      >;
      return rows.map((item) => ({
        ...item,
        ownerUserId: item.ownerUserId ?? '',
        notice: item.notice ?? '',
        photos: item.photos.map((photo) => ({
          id: photo.id,
          contentType: photo.contentType,
          bytes: fromBase64(photo.base64),
        })),
      }));
    },
    async put(item) {
      await wait(
        (await store('readwrite')).put({
          ...item,
          photos: item.photos.map((photo) => ({
            id: photo.id,
            contentType: photo.contentType,
            base64: toBase64(photo.bytes),
          })),
        })
      );
    },
    async remove(localId) {
      await wait((await store('readwrite')).delete(localId));
    },
  };
}

let active: VariationQueueStore | null = null;

export function getVariationQueue(): VariationQueueStore {
  if (!active) {
    active = indexedDbQueue() ?? (typeof localStorage !== 'undefined' ? storageVariationQueue(localStorage) : memoryVariationQueue());
  }
  return active;
}

export function setVariationQueueForTests(store: VariationQueueStore | null) {
  active = store;
}

export function fixtureForceOffline(): boolean {
  if (__DEV__ && process.env.EXPO_PUBLIC_USE_FIXTURES === '1') {
    try {
      return globalThis.localStorage?.getItem('sitepack.dev.forceOffline') === '1';
    } catch {
      return false;
    }
  }
  return false;
}

export function setFixtureForceOffline(offline: boolean): void {
  if (__DEV__ && process.env.EXPO_PUBLIC_USE_FIXTURES === '1') {
    const storage = globalThis.localStorage;
    if (!storage) return;
    if (offline) storage.setItem('sitepack.dev.forceOffline', '1');
    else storage.removeItem('sitepack.dev.forceOffline');
  }
}

export async function deviceIsOnline(): Promise<boolean> {
  if (fixtureForceOffline()) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const network = await import('expo-network');
    const state = await network.getNetworkStateAsync();
    if (state.isConnected === false || state.isInternetReachable === false) return false;
  } catch {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }
  return true;
}

export async function persistThenSend(
  item: QueuedVariation,
  online: boolean,
  send: (item: QueuedVariation) => Promise<void>,
  queue: VariationQueueStore = getVariationQueue()
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

/** Send this user's queued variations. Drop anyone else's without a network call. */
export async function flushVariationQueue(
  userId: string,
  siteId: string,
  online: boolean,
  send: (item: QueuedVariation) => Promise<void>,
  queue: VariationQueueStore = getVariationQueue()
): Promise<QueuedVariation[]> {
  const rows = await queue.list();
  for (const item of rows) {
    if (item.ownerUserId !== userId) {
      await queue.remove(item.localId);
      continue;
    }
    if (item.siteId !== siteId || !online) continue;
    try {
      await send(item);
      await queue.remove(item.localId);
    } catch {
      break;
    }
  }
  return (await queue.list()).filter((item) => item.ownerUserId === userId && item.siteId === siteId);
}

/** Drop every variation queue key and the web IndexedDB store. */
export async function clearVariationQueue(storage?: MemoryStorage): Promise<void> {
  active = null;
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (store) clearVariationQueueStorage(store);
  try {
    openDatabase?.close();
  } catch {
    // Already closed.
  }
  openDatabase = null;
  const factory = (globalThis as { indexedDB?: { deleteDatabase: (name: string) => IdbRequest } }).indexedDB;
  if (!factory) return;
  try {
    await wait(factory.deleteDatabase('sitepack-variations'));
  } catch {
    // Already gone.
  }
}
