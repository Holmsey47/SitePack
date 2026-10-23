import { forgetSharedSiteStorage } from '@/data/sharing';
import { deleteSiteCache } from '@/lib/offline';

/** Drop this site's offline pack and queued rows after a share is refused. */
export async function forgetSharedSite(siteId: string): Promise<void> {
  try {
    const storage = globalThis.localStorage;
    if (storage) forgetSharedSiteStorage(storage, siteId);
  } catch {
    // Native storage can refuse a read. The file cache still goes.
  }
  await deleteSiteCache(siteId);
}
