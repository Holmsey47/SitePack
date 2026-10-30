import { mapHomeNewCounts, type HomeKindCounts } from '@/data/homeNewCounts';

type HomeCountsRpc = (name: string) => Promise<{ data: unknown; error: { message?: string } | null }>;

async function defaultRpc(name: string): Promise<{ data: unknown; error: { message?: string } | null }> {
  const { getSupabase } = await import('@/lib/supabase');
  const { data, error } = await getSupabase().rpc(name);
  return { data, error };
}

/**
 * One read for every site this login can open. A thrown client, a PostgREST
 * error, or a payload we cannot map all hide the counts.
 */
export async function loadHomeSiteNewCounts(
  rpc: HomeCountsRpc = defaultRpc,
): Promise<Record<string, HomeKindCounts> | null> {
  if (rpc === defaultRpc && process.env.EXPO_PUBLIC_USE_FIXTURES === '1') {
    const { fixtureHomeNewCounts } = await import('@/data/fixtureRepo');
    return fixtureHomeNewCounts();
  }
  try {
    const { data, error } = await rpc('home_site_new_counts');
    if (error) return null;
    return mapHomeNewCounts(data);
  } catch {
    return null;
  }
}
