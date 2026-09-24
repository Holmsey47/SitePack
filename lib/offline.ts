import { PACK_DIRECTORY_CREATE } from '@/data/walk';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { HomeSite, ManifestItem } from '@/data/types';

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
      });
    }
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
    });
  }
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
