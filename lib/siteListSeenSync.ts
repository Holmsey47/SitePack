import { repo } from '@/data/index';
import { countNewSince, type SiteListKind } from '@/data/siteListSeen';
import { getSupabase } from '@/lib/supabase';

export type SeenAtByKind = Partial<Record<SiteListKind, string | null>>;

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

export async function markSiteListSeen(siteId: string, kind: SiteListKind): Promise<void> {
  try {
    const supabase = getSupabase();
    const { data, error: userError } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (userError || !userId) return;
    await supabase.from('site_list_seen').upsert(
      { user_id: userId, site_id: siteId, kind, seen_at: new Date().toISOString() },
      { onConflict: 'user_id,site_id,kind' }
    );
  } catch {
    // Opening the list still works when the draft table is absent.
  }
}

/** Counts of rows this user can already load. Null hides every badge. */
export async function siteBarCounts(siteId: string): Promise<Partial<Record<SiteListKind, number>> | null> {
  const seen = await readSiteListSeen(siteId);
  if (!seen) return null;
  const [snags, variations, requests] = await Promise.all([
    repo
      .listSnags(siteId)
      .then((list) => list.rows.map((row) => row.raised_at))
      .catch(() => null),
    repo
      .listVariations(siteId)
      .then((list) => list.rows.map((row) => row.created_at))
      .catch(() => null),
    repo
      .listSiteRequests(siteId)
      .then((rows) => rows.map((row) => row.created_at))
      .catch(() => null),
  ]);
  const counts: Partial<Record<SiteListKind, number>> = {};
  if (snags) counts.snags = countNewSince(snags, seen.snags);
  if (variations) counts.variations = countNewSince(variations, seen.variations);
  if (requests) counts.requests = countNewSince(requests, seen.requests);
  return counts;
}
