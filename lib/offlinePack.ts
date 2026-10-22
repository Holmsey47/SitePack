export type PackRevision = {
  drawingId: string;
  revision: string;
};

const PACK_KEY_PREFIX = 'sitepack.offline.pack.';

/** Drawing files from the previous pack that are not in the current manifest. */
export function drawingIdsToDelete(cachedIds: readonly string[], currentIds: readonly string[]): string[] {
  const current = new Set(currentIds);
  const seen = new Set<string>();
  const drop: string[] = [];
  for (const id of cachedIds) {
    if (!id || current.has(id) || seen.has(id)) continue;
    seen.add(id);
    drop.push(id);
  }
  return drop;
}

/** Cached site packs whose site is no longer assigned. */
export function siteIdsToDrop(cachedSiteIds: readonly string[], assignedSiteIds: readonly string[]): string[] {
  const assigned = new Set(assignedSiteIds);
  const seen = new Set<string>();
  const drop: string[] = [];
  for (const id of cachedSiteIds) {
    if (!id || assigned.has(id) || seen.has(id)) continue;
    seen.add(id);
    drop.push(id);
  }
  return drop;
}

export function siteIdsFromPackKeys(keys: readonly string[]): string[] {
  const ids: string[] = [];
  for (const key of keys) {
    if (!key.startsWith(PACK_KEY_PREFIX)) continue;
    const id = key.slice(PACK_KEY_PREFIX.length);
    if (id) ids.push(id);
  }
  return ids;
}

/** Current revisions are downloaded on Wi-Fi only. */
export function downloadsOnWifi(type: string | null | undefined): boolean {
  return type === 'WIFI';
}

export function packNeedsDownload(
  meta: { items: readonly PackRevision[] } | null,
  current: readonly { drawing_id: string; revision: string }[]
): boolean {
  if (current.length === 0) return meta != null && meta.items.length > 0;
  if (!meta) return true;
  if (meta.items.length !== current.length) return true;
  for (const item of current) {
    const hit = meta.items.find((row) => row.drawingId === item.drawing_id);
    if (!hit || hit.revision !== item.revision) return true;
  }
  return false;
}

/**
 * The cached copy is stale when its revisions differ from the current pack.
 * With no current list, it is stale when the site was updated after the download.
 */
export function packIsStale(
  meta: { downloadedAt: string; items: readonly PackRevision[] } | null,
  source: { updatedAt?: string | null; current?: readonly PackRevision[] | null }
): boolean {
  if (!meta || meta.items.length === 0) return false;
  if (source.current) {
    if (source.current.length !== meta.items.length) return true;
    for (const item of source.current) {
      const hit = meta.items.find((row) => row.drawingId === item.drawingId);
      if (!hit || hit.revision !== item.revision) return true;
    }
    return false;
  }
  if (!source.updatedAt) return false;
  const updated = Date.parse(source.updatedAt);
  const downloaded = Date.parse(meta.downloadedAt);
  if (!Number.isFinite(updated) || !Number.isFinite(downloaded)) return false;
  return updated > downloaded;
}

/** One cached sheet is stale when the live revision differs, or the site moved on after download. */
export function drawingCopyIsStale(
  meta: { downloadedAt: string; items: readonly PackRevision[] } | null,
  drawingId: string,
  live: { revision: string } | null,
  updatedAt?: string | null
): boolean {
  if (!meta) return false;
  const hit = meta.items.find((item) => item.drawingId === drawingId);
  if (!hit) return false;
  if (live) return hit.revision !== live.revision;
  if (!updatedAt) return false;
  const updated = Date.parse(updatedAt);
  const downloaded = Date.parse(meta.downloadedAt);
  return Number.isFinite(updated) && Number.isFinite(downloaded) && updated > downloaded;
}
