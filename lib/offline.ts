import { PACK_DIRECTORY_CREATE } from '@/data/walk';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { HomeSite, ManifestItem } from '@/data/types';
import { drawingIdsToDelete, siteIdsFromPackKeys } from '@/lib/offlinePack';

const SITES_KEY = 'sitepack.offline.sites';
const PACK_KEY = (siteId: string) => `sitepack.offline.pack.${siteId}`;

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

export function cacheAssignedSites(sites: HomeSite[]) {
  writeJson(SITES_KEY, sites);
}

export function readCachedSites(): HomeSite[] {
  return readJson<HomeSite[]>(SITES_KEY) ?? [];
}

export function readPackMeta(siteId: string): OfflinePackMeta | null {
  return readJson<OfflinePackMeta>(PACK_KEY(siteId));
}

export function cachedPackSiteIds(): string[] {
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

async function removeDrawingFiles(siteId: string, dropIds: readonly string[], currentIds: readonly string[]): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      const cache = await caches.open('sitepack-drawings');
      for (const id of dropIds) await cache.delete(id);
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
      const file = new File(folder, `${id}.pdf`);
      if (file.exists) file.delete();
    }
    for (const entry of folder.list()) {
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

/** Drop cached files for one site. Used on sign-out and when the person is removed. */
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

export async function deleteAllDrawingCaches(): Promise<void> {
  const siteIds = cachedPackSiteIds();
  for (const siteId of siteIds) await deleteSiteCache(siteId);
  try {
    globalThis.localStorage?.removeItem(SITES_KEY);
  } catch {
    // Files are the part that must go.
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

/** Delete superseded revisions that are still on disk after a sync that did not re-download. */
export async function deleteSupersededDrawings(siteId: string, currentIds: readonly string[]): Promise<void> {
  const meta = readPackMeta(siteId);
  const dropIds = drawingIdsToDelete(meta?.items.map((item) => item.drawingId) ?? [], currentIds);
  await removeDrawingFiles(siteId, dropIds, currentIds);
  if (!meta) return;
  const keep = new Set(currentIds);
  const items = meta.items.filter((item) => keep.has(item.drawingId));
  if (items.length === meta.items.length) return;
  writeJson(PACK_KEY(siteId), { ...meta, items });
}

export async function downloadCurrentPack(
  siteId: string,
  items: ManifestItem[],
  onProgress?: (done: number, total: number) => void
): Promise<OfflinePackMeta> {
  const saved: OfflinePackMeta = {
    siteId,
    downloadedAt: new Date().toISOString(),
    items: [],
  };
  const previousIds = readPackMeta(siteId)?.items.map((item) => item.drawingId) ?? [];
  const currentIds = items.map((item) => item.drawing_id);
  const dropIds = drawingIdsToDelete(previousIds, currentIds);

  if (Platform.OS === 'web') {
    const cache = await caches.open('sitepack-drawings');
    let done = 0;
    for (const item of items) {
      const response = await fetch(item.signed_url);
      if (!response.ok) throw new Error('Download failed — retry. Current pointer was not changed.');
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
    }
    await removeDrawingFiles(siteId, dropIds, currentIds);
    writeJson(PACK_KEY(siteId), saved);
    return saved;
  }

  const folder = new Directory(Paths.document, 'sitepack', siteId);
  folder.create(PACK_DIRECTORY_CREATE);

  let done = 0;
  for (const item of items) {
    const destination = new File(folder, `${item.drawing_id}.pdf`);
    const downloaded = await File.downloadFileAsync(item.signed_url, destination, { idempotent: true });
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
  }
  await removeDrawingFiles(siteId, dropIds, currentIds);
  writeJson(PACK_KEY(siteId), saved);
  return saved;
}

export async function localDrawingUri(siteId: string, drawingId: string): Promise<string | null> {
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
