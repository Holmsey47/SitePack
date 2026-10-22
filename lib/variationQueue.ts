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
};

const QUEUE_KEY = 'sitepack.variation.queue';

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

/** JSON storage. A new store on the same object still has the photos. */
export function storageVariationQueue(storage: MemoryStorage): VariationQueueStore {
  return {
    async list() {
      const raw = storage.getItem(QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Array<Omit<QueuedVariation, 'photos'> & { photos: Array<Omit<QueuedPhoto, 'bytes'> & { base64: string }> }>;
      return parsed.map((item) => ({
        ...item,
        photos: item.photos.map((photo) => ({
          id: photo.id,
          contentType: photo.contentType,
          bytes: fromBase64(photo.base64),
        })),
      }));
    },
    async put(item) {
      const current = JSON.parse(storage.getItem(QUEUE_KEY) ?? '[]') as unknown[];
      const next = current.filter((row) => (row as { localId?: string }).localId !== item.localId);
      next.push({
        ...item,
        photos: item.photos.map((photo) => ({
          id: photo.id,
          contentType: photo.contentType,
          base64: toBase64(photo.bytes),
        })),
      });
      storage.setItem(QUEUE_KEY, JSON.stringify(next));
    },
    async remove(localId) {
      const current = JSON.parse(storage.getItem(QUEUE_KEY) ?? '[]') as Array<{ localId?: string }>;
      storage.setItem(QUEUE_KEY, JSON.stringify(current.filter((row) => row.localId !== localId)));
    },
  };
}

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
    request.onsuccess = () => resolve(request.result);
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
