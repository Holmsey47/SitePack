import { PACK_DIRECTORY_CREATE } from '@/data/walk';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { removeDrawingSeenKeys } from '@/lib/drawingSeenQueue';
import { deleteSnagIndexedDb, removeSnagQueueKeys } from '@/lib/snagQueue';

import type { HomeSite, ManifestItem } from '@/data/types';
import { drawingIdsToDelete, siteIdsFromPackKeys } from '@/lib/offlinePack';
import { clearVariationQueue } from '@/lib/variationQueue';
import {
  cacheReadable,
  claimCacheSession,
  createCacheSession,
  finishClaim,
  editOwnedCache,
  forgetSessionCache,
  readOwned,
  writePackFiles,
  writeStillCurrent,
  type CacheSession,
} from '@/lib/offlineGuard';

const SITES_KEY = 'sitepack.offline.sites';
const OWNER_KEY = 'sitepack.offline.owner';
const PACK_KEY = (siteId: string) => `sitepack.offline.pack.${siteId}`;
const OWNER_FILE = 'owner.json';

export type OfflinePackMeta = {
  siteId: string;
  downloadedAt: string;
  items: Array<{
    drawingId: string;
    revision: string;
    title: string;
    localUri?: string;
    fileSizeBytes: number | null;
    /** Display only. Copied from the manifest. */
    level: string | null;
  }>;
};

const session: CacheSession = createCacheSession();
let wipeRunning = false;

function readJson<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
}

function persistedOwnerUserId(): string | null {
  const stored = readJson<{ userId?: string }>(OWNER_KEY);
  const fromStore = typeof stored?.userId === 'string' && stored.userId ? stored.userId : null;
  if (Platform.OS === 'web') return fromStore;
  const fromFile = readOwnerFile();
  if (!fromStore || !fromFile || fromStore !== fromFile) return null;
  return fromStore;
}

function readOwnerFile(): string | null {
  try {
    const file = new File(new Directory(Paths.document, 'sitepack'), OWNER_FILE);
    if (!file.exists) return null;
    const parsed = JSON.parse(file.textSync()) as { userId?: unknown };
    return typeof parsed.userId === 'string' && parsed.userId ? parsed.userId : null;
  } catch {
    return null;
  }
}

function writeOwner(userId: string) {
  writeJson(OWNER_KEY, { userId });
  if (Platform.OS === 'web') return;
  try {
    const root = new Directory(Paths.document, 'sitepack');
    root.create(PACK_DIRECTORY_CREATE);
    const file = new File(root, OWNER_FILE);
    if (!file.exists) file.create();
    file.write(JSON.stringify({ userId }));
  } catch {
    // The local record still names the owner. A missing file fails the next read closed.
  }
}

function clearLocalMetadata() {
  try {
    const store = globalThis.localStorage;
    if (store) {
      const keys: string[] = [];
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        if (!key) continue;
        if (key === SITES_KEY || key === OWNER_KEY || key.startsWith('sitepack.offline.pack.') || key.startsWith('sitepack.variation.')) keys.push(key);
      }
      for (const key of keys) store.removeItem(key);
      removeDrawingSeenKeys(store);
      removeSnagQueueKeys(store);
    }
  } catch {
    // The file delete still runs.
  }
  deleteSnagIndexedDb();
}

async function deleteStoredFiles(): Promise<void> {
  try {
    await clearVariationQueue();
  } catch {
    // The drawing wipe still runs.
  }
  if (Platform.OS === 'web') {
    try {
      await caches.delete('sitepack-drawings');
    } catch {
      // Already gone.
    }
    return;
  }
  try {
    const root = new Directory(Paths.document, 'sitepack');
    if (root.exists) root.delete();
  } catch {
    // Already gone.
  }
}

async function wipeStoredBytes(generation: number): Promise<void> {
  if (wipeRunning) return;
  wipeRunning = true;
  const userId = session.userId;
  clearLocalMetadata();
  let deleted = true;
  try {
    await deleteStoredFiles();
  } catch {
    deleted = false;
  }
  wipeRunning = false;
  if (deleted && userId && finishClaim(session, userId, generation)) writeOwner(userId);
}

function canReadCache(): boolean {
  if (wipeRunning && !cacheReadable(session)) return false;
  const read = readOwned(session, () => true, false);
  if (read.wipe) void wipeStoredBytes(session.generation);
  return read.value;
}

/** Drop every cached drawing. Used when the session ends, whoever ended it. */
export async function deleteAllDrawingCaches(): Promise<void> {
  forgetSessionCache(session, clearLocalMetadata);
  try {
    await deleteStoredFiles();
  } catch {
    // Already gone.
  }
}

/** Keep this user's cache. Wipe first when the stored owner is missing or different. */
export async function adoptCacheOwner(userId: string): Promise<void> {
  if (!userId) return;
  const action = claimCacheSession(session, userId);
  if (action === 'kept') return;
  const generation = session.generation;
  clearLocalMetadata();
  let deleted = true;
  try {
    await deleteStoredFiles();
  } catch {
    deleted = false;
  }
  if (!deleted || !finishClaim(session, userId, generation)) return;
  writeOwner(userId);
}

export function cacheAssignedSites(sites: HomeSite[]) {
  if (!canReadCache()) return;
  writeJson(SITES_KEY, sites);
}

export function readCachedSites(): HomeSite[] {
  if (wipeRunning && !cacheReadable(session)) return [];
  const read = readOwned(session, () => readJson<HomeSite[]>(SITES_KEY) ?? [], [] as HomeSite[]);
  if (read.wipe) void wipeStoredBytes(session.generation);
  return read.value;
}

export function readPackMeta(siteId: string): OfflinePackMeta | null {
  if (wipeRunning && !cacheReadable(session)) return null;
  const read = readOwned(session, () => readJson<OfflinePackMeta>(PACK_KEY(siteId)), null);
  if (read.wipe) void wipeStoredBytes(session.generation);
  return read.value;
}

export function cachedPackSiteIds(): string[] {
  if (!canReadCache()) return [];
  try {
    const store = globalThis.localStorage;
    if (!store) return [];
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key) keys.push(key);
    }
    return siteIdsFromPackKeys(keys);
  } catch {
    return [];
  }
}

async function removeDrawingFiles(
  siteId: string,
  dropIds: readonly string[],
  currentIds: readonly string[],
  allowed: () => boolean = () => true
): Promise<void> {
  if (!allowed()) return;
  if (Platform.OS === 'web') {
    try {
      const cache = await caches.open('sitepack-drawings');
      for (const id of dropIds) {
        if (!allowed()) return;
        await cache.delete(id);
      }
    } catch {
      // The meta write still drops the superseded rows.
    }
    return;
  }
  try {
    const folder = new Directory(Paths.document, 'sitepack', siteId);
    if (!folder.exists) return;
    const keep = new Set(currentIds);
    for (const id of dropIds) {
      if (!allowed()) return;
      const file = new File(folder, `${id}.pdf`);
      if (file.exists) file.delete();
    }
    for (const entry of folder.list()) {
      if (!allowed()) return;
      if (entry instanceof Directory) continue;
      const name = decodeURIComponent(entry.uri.split('/').pop() ?? '');
      if (!name.endsWith('.pdf')) continue;
      const id = name.slice(0, -'.pdf'.length);
      if (!keep.has(id) && entry.exists) entry.delete();
    }
  } catch {
    // A missing folder is already clean.
  }
}

/** Drop cached files for one site when the person is removed from it. */
export async function deleteSiteCache(siteId: string): Promise<void> {
  const ids = readPackMeta(siteId)?.items.map((item) => item.drawingId) ?? [];
  try {
    globalThis.localStorage?.removeItem(PACK_KEY(siteId));
  } catch {
    // The files still go.
  }
  await removeDrawingFiles(siteId, ids, []);
  if (Platform.OS === 'web') return;
  try {
    const folder = new Directory(Paths.document, 'sitepack', siteId);
    if (folder.exists) folder.delete();
  } catch {
    // Already gone.
  }
}

/** Delete superseded revisions that are still on disk after a sync that did not re-download. */
export async function deleteSupersededDrawings(siteId: string, currentIds: readonly string[]): Promise<void> {
  if (!canReadCache()) return;
  const startedGeneration = session.generation;
  const startedUser = session.userId;
  const allowed = () => writeStillCurrent(session, startedGeneration, startedUser);
  if (!allowed()) return;
  const meta = readPackMeta(siteId);
  if (!allowed()) return;
  const dropIds = drawingIdsToDelete(meta?.items.map((item) => item.drawingId) ?? [], currentIds);
  await editOwnedCache({
    allowed,
    mutate: () => removeDrawingFiles(siteId, dropIds, currentIds, allowed),
    commit: () => {
      if (!meta || !allowed()) return;
      const keep = new Set(currentIds);
      const items = meta.items.filter((item) => keep.has(item.drawingId));
      if (items.length === meta.items.length) return;
      writeJson(PACK_KEY(siteId), { ...meta, items });
    },
  });
}

export async function downloadCurrentPack(
  siteId: string,
  items: ManifestItem[],
  onProgress?: (done: number, total: number) => void
): Promise<OfflinePackMeta> {
  if (!canReadCache()) throw new Error('Download stopped.');
  const startedGeneration = session.generation;
  const startedUser = session.userId;
  const allowed = () => writeStillCurrent(session, startedGeneration, startedUser);
  const saved: OfflinePackMeta = {
    siteId,
    downloadedAt: new Date().toISOString(),
    items: [],
  };
  const previousIds = readPackMeta(siteId)?.items.map((item) => item.drawingId) ?? [];
  const currentIds = items.map((item) => item.drawing_id);
  const dropIds = drawingIdsToDelete(previousIds, currentIds);
  let done = 0;

  const commit = async () => {
    if (!allowed()) return;
    await removeDrawingFiles(siteId, dropIds, currentIds);
    if (!allowed()) return;
    writeJson(PACK_KEY(siteId), saved);
  };

  if (Platform.OS === 'web') {
    const cache = await caches.open('sitepack-drawings');
    const outcome = await writePackFiles({
      allowed,
      items,
      write: async (item) => {
        const response = await fetch(item.signed_url);
        if (!response.ok) throw new Error('Download failed — retry. Current pointer was not changed.');
        if (!allowed()) return;
        await cache.put(item.drawing_id, response);
        done += 1;
        onProgress?.(done, items.length);
        saved.items.push({
          drawingId: item.drawing_id,
          revision: item.revision,
          title: item.title,
          fileSizeBytes: item.file_size_bytes,
          level: item.level ?? null,
        });
      },
      discard: async (item) => {
        try {
          await cache.delete(item.drawing_id);
        } catch {
          // The wipe already removed the cache.
        }
        saved.items = saved.items.filter((row) => row.drawingId !== item.drawing_id);
      },
      commit,
    });
    if (outcome === 'cancelled') throw new Error('Download stopped.');
    return saved;
  }

  const folder = new Directory(Paths.document, 'sitepack', siteId);
  if (!allowed()) throw new Error('Download stopped.');
  folder.create(PACK_DIRECTORY_CREATE);
  const outcome = await writePackFiles({
    allowed,
    items,
    write: async (item) => {
      if (!allowed()) return;
      const destination = new File(folder, `${item.drawing_id}.pdf`);
      const downloaded = await File.downloadFileAsync(item.signed_url, destination, { idempotent: true });
      if (!allowed()) return;
      done += 1;
      onProgress?.(done, items.length);
      saved.items.push({
        drawingId: item.drawing_id,
        revision: item.revision,
        title: item.title,
        localUri: downloaded.uri,
        fileSizeBytes: item.file_size_bytes,
        level: item.level ?? null,
      });
    },
    discard: async (item) => {
      try {
        const destination = new File(folder, `${item.drawing_id}.pdf`);
        if (destination.exists) destination.delete();
      } catch {
        // The wipe already removed the folder.
      }
      saved.items = saved.items.filter((row) => row.drawingId !== item.drawing_id);
    },
    commit,
  });
  if (outcome === 'cancelled') throw new Error('Download stopped.');
  return saved;
}

export async function localDrawingUri(siteId: string, drawingId: string): Promise<string | null> {
  if (!canReadCache()) return null;
  const meta = readPackMeta(siteId);
  const hit = meta?.items.find((item) => item.drawingId === drawingId);
  if (Platform.OS === 'web') {
    try {
      const cache = await caches.open('sitepack-drawings');
      const cached = await cache.match(drawingId);
      if (!cached) return null;
      const blob = await cached.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }
  if (hit?.localUri) return hit.localUri;
  try {
    const file = new File(new Directory(Paths.document, 'sitepack', siteId), `${drawingId}.pdf`);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

export function isPackReady(siteId: string, currentIds: string[]): boolean {
  const meta = readPackMeta(siteId);
  if (!meta) return false;
  return currentIds.every((id) => meta.items.some((item) => item.drawingId === id));
}

session.ownerUserId = persistedOwnerUserId();

/** The user the on-device cache belongs to, or null when nobody owns it yet. */
export function cacheOwnerUserId(): string | null {
  return session.ownerUserId;
}
