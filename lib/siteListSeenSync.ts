import { countUnseen, saveSeenWithRetry, type SiteListKind } from '@/data/siteListSeen';
import { getSupabase } from '@/lib/supabase';

export type SeenAtByKind = Partial<Record<SiteListKind, string | null>>;

const KINDS = ['snags', 'variations', 'requests'] as const;
const pendingSaves = new Map<string, Promise<boolean>>();

/**
 * Null means the badge must stay hidden: the table is missing, or the read failed.
 * An empty object means this user has not opened any list, so every visible row is new.
 */
export async function readSiteListSeen(siteId: string): Promise<SeenAtByKind | null> {
  try {
    const { data, error } = await getSupabase()
      .from('site_list_seen')
      .select('kind, seen_at')
      .eq('site_id', siteId);
    if (error || !data) return null;
    const seen: SeenAtByKind = {};
    for (const row of data as { kind?: string; seen_at?: string | null }[]) {
      if (row.kind === 'snags' || row.kind === 'variations' || row.kind === 'requests') {
        seen[row.kind] = row.seen_at ?? null;
      }
    }
    return seen;
  } catch {
    return null;
  }
}

async function writeSiteListSeen(siteId: string, kind: SiteListKind): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error: userError } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (userError || !userId) return false;
  // seen_at is stamped by the database clock. Sending a client time would override it.
  const { error } = await supabase.from('site_list_seen').upsert(
    { user_id: userId, site_id: siteId, kind },
    { onConflict: 'user_id,site_id,kind' },
  );
  return !error;
}

/** Saves seen for this list. A second caller joins the save already in flight. */
export function markSiteListSeen(siteId: string, kind: SiteListKind): Promise<boolean> {
  const key = `${siteId}:${kind}`;
  const current = pendingSaves.get(key);
  if (current) return current;
  const run = saveSeenWithRetry(() => writeSiteListSeen(siteId, kind));
  pendingSaves.set(key, run);
  void run.finally(() => {
    if (pendingSaves.get(key) === run) pendingSaves.delete(key);
  });
  return run;
}

/** Saves started and not yet finished. The site page waits for these before it re-reads counts. */
export function pendingSiteListSaves(siteId: string): Promise<boolean>[] {
  const waiting: Promise<boolean>[] = [];
  for (const kind of KINDS) {
    const run = pendingSaves.get(`${siteId}:${kind}`);
    if (run) waiting.push(run);
  }
  return waiting;
}

type CountQuery = {
  data: Record<string, string | null>[] | null;
  error: { message?: string } | null;
};

function counted(result: CountQuery, atKey: string, byKey: string): { at: string; by: string | null }[] | null {
  if (result.error || !result.data) return null;
  const rows: { at: string; by: string | null }[] = [];
  for (const row of result.data) {
    const at = row[atKey];
    if (typeof at !== 'string' || at.length === 0) continue;
    const by = row[byKey];
    rows.push({ at, by: typeof by === 'string' ? by : null });
  }
  return rows;
}

/**
 * Counts of rows this user can already select. Own rows are left out.
 * Null hides every badge.
 */
export async function siteBarCounts(
  siteId: string,
  selfId: string | null,
): Promise<Partial<Record<SiteListKind, number>> | null> {
  const seen = await readSiteListSeen(siteId);
  if (!seen) return null;
  try {
    const supabase = getSupabase();
    const [snags, variations, requests] = await Promise.all([
      supabase.from('snags').select('raised_at, raised_by').eq('site_id', siteId),
      supabase
        .from('variation_versions')
        .select('created_at, created_by')
        .eq('site_id', siteId)
        .eq('is_current', true),
      supabase.from('drawing_requests').select('created_at, requester_id').eq('site_id', siteId),
    ]);
    const counts: Partial<Record<SiteListKind, number>> = {};
    const snagRows = counted(snags as CountQuery, 'raised_at', 'raised_by');
    const variationRows = counted(variations as CountQuery, 'created_at', 'created_by');
    const requestRows = counted(requests as CountQuery, 'created_at', 'requester_id');
    if (snagRows) counts.snags = countUnseen(snagRows, seen.snags, selfId);
    if (variationRows) counts.variations = countUnseen(variationRows, seen.variations, selfId);
    if (requestRows) counts.requests = countUnseen(requestRows, seen.requests, selfId);
    return counts;
  } catch {
    return null;
  }
}
