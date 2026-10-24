/** Site-page bar. Drawings stays on the site screen and is not a fourth item. */
export const SITE_BAR = [
  { kind: 'snags', label: 'Snags', path: (siteId: string) => `/sites/${siteId}/snags` },
  { kind: 'variations', label: 'Variations', path: (siteId: string) => `/sites/${siteId}/variations` },
  { kind: 'requests', label: 'Requests', path: (siteId: string) => `/sites/${siteId}/requests` },
] as const;

export type SiteListKind = (typeof SITE_BAR)[number]['kind'];

/** Glove target for each bar button, and clearance under the last drawing. */
export const SITE_BAR_MIN_HEIGHT = 48;
export const DRAWINGS_LIST_BOTTOM_PAD = 72;

/**
 * Rows newer than the last open. A missing seen time counts every current row,
 * because this user has not opened the list yet.
 */
export function countNewSince(timestamps: readonly string[], seenAt: string | null | undefined): number {
  if (seenAt == null || seenAt === '') return timestamps.length;
  const seen = Date.parse(seenAt);
  if (Number.isNaN(seen)) return timestamps.length;
  let count = 0;
  for (const stamp of timestamps) {
    const at = Date.parse(stamp);
    if (!Number.isNaN(at) && at > seen) count += 1;
  }
  return count;
}

/** PostgREST or Postgres when the draft table has not been applied. */
export function isMissingSeenTable(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const message = `${error.message ?? ''}`.toLowerCase();
  return code === '42P01' || code === 'PGRST205' || message.includes('site_list_seen');
}
