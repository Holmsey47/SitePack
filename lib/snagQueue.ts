export { SAVED_ON_PHONE, deviceIsOnline } from '@/lib/variationQueue';

export type QueuedPhoto = {
  id: string;
  contentType: string;
  bytes: Uint8Array;
};

export type QueuedSnagCreate = {
  kind: 'create';
  localId: string;
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
  siteId: string;
  companyId: string;
  snagId: string;
  photos: QueuedPhoto[];
  fixedAt: string;
};

export type QueuedSnagSign = {
  kind: 'sign';
  localId: string;
  siteId: string;
  snagId: string;
  signedAt: string;
  mode: 'manager' | 'contractor';
  signerName?: string;
  signerRole?: string;
  signerCompany?: string;
  signaturePng?: string;
};

export type QueuedSnag = QueuedSnagCreate | QueuedSnagFix | QueuedSnagSign;

export type SnagQueueStore = {
  list(): Promise<QueuedSnag[]>;
  put(item: QueuedSnag): Promise<void>;
  remove(localId: string): Promise<void>;
};

function copyPhoto(photo: QueuedPhoto): QueuedPhoto {
  return { ...photo, bytes: new Uint8Array(photo.bytes) };
}

function copyItem(item: QueuedSnag): QueuedSnag {
  if (item.kind === 'sign') return { ...item };
  return { ...item, photos: item.photos.map(copyPhoto) };
}

export function memorySnagQueue(): SnagQueueStore {
  const rows = new Map<string, QueuedSnag>();
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

const QUEUE_KEY = 'sitepack.snag.queue';

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
type StoredSnag = Omit<QueuedSnagCreate, 'photos'> & { photos?: StoredPhoto[] } | Omit<QueuedSnagFix, 'photos'> & { photos?: StoredPhoto[] } | QueuedSnagSign;

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

export function storageSnagQueue(storage: MemoryStorage): SnagQueueStore {
  function read(): QueuedSnag[] {
    const raw = storage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as StoredSnag[]).map(decode);
  }

  function write(rows: QueuedSnag[]) {
    storage.setItem(QUEUE_KEY, JSON.stringify(rows.map(encode)));
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

function indexedDbQueue(): SnagQueueStore | null {
  const factory = (globalThis as { indexedDB?: { open: (name: string, version: number) => IdbRequest & { onupgradeneeded: (() => void) | null } } }).indexedDB;
  if (!factory) return null;
  const opened = new Promise<unknown>((resolve, reject) => {
    const request = factory.open('sitepack-snags', 1);
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
      const rows = (await wait((await store('readonly')).getAll())) as StoredSnag[];
      return rows.map(decode).map(copyItem);
    },
    async put(item) {
      await wait((await store('readwrite')).put(encode(item)));
    },
    async remove(localId) {
      await wait((await store('readwrite')).delete(localId));
    },
  };
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
