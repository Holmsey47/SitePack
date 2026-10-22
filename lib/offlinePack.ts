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

export type PhoneSheet = {
  drawingId: string;
  title: string;
  revision: string;
};

export type PhoneSheetRow = PhoneSheet & {
  /** Set when the phone does not have this current revision. */
  changedLabel: string | null;
};

/**
 * Phone rows in pack order, then any current sheet the phone does not have.
 * A changed row names the live revision that is not on the phone.
 */
export function phoneSheetRows(
  phone: readonly PhoneSheet[],
  current: readonly PhoneSheet[] | null
): PhoneSheetRow[] {
  if (!current) {
    return phone.map((item) => ({ ...item, changedLabel: null }));
  }
  const liveById = new Map(current.map((item) => [item.drawingId, item]));
  const seen = new Set<string>();
  const rows: PhoneSheetRow[] = [];
  for (const item of phone) {
    if (!item.drawingId || seen.has(item.drawingId)) continue;
    seen.add(item.drawingId);
    const live = liveById.get(item.drawingId);
    if (live && live.revision !== item.revision) {
      const title = live.title || item.title;
      rows.push({
        drawingId: item.drawingId,
        title,
        revision: item.revision,
        changedLabel: `${title} · new Rev ${live.revision}, not on phone`,
      });
      continue;
    }
    if (!live) {
      rows.push({
        drawingId: item.drawingId,
        title: item.title,
        revision: item.revision,
        changedLabel: `${item.title} · Rev ${item.revision} is no longer current`,
      });
      continue;
    }
    rows.push({ drawingId: item.drawingId, title: item.title, revision: item.revision, changedLabel: null });
  }
  for (const live of current) {
    if (!live.drawingId || seen.has(live.drawingId)) continue;
    seen.add(live.drawingId);
    rows.push({
      drawingId: live.drawingId,
      title: live.title,
      revision: live.revision,
      changedLabel: `${live.title} · new Rev ${live.revision}, not on phone`,
    });
  }
  return rows;
}

export function changedSheetCount(rows: readonly { changedLabel: string | null }[]): number {
  return rows.reduce((count, row) => count + (row.changedLabel ? 1 : 0), 0);
}

/** "Phone copy is out of date. 1 sheet changed since 22 Oct." */
export function phoneCopyOutOfDateLine(count: number, downloadedAt: string): string {
  const date = new Date(downloadedAt);
  const day = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  const sheets = count === 1 ? '1 sheet changed' : `${count} sheets changed`;
  return day
    ? `Phone copy is out of date. ${sheets} since ${day}.`
    : `Phone copy is out of date. ${sheets}.`;
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
