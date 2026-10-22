import { repo } from '@/data/index';
import {
  cachedPackSiteIds,
  deleteSiteCache,
  deleteSupersededDrawings,
  downloadCurrentPack,
  readPackMeta,
} from '@/lib/offline';
import { downloadsOnWifi, packNeedsDownload, siteIdsToDrop } from '@/lib/offlinePack';
import * as Network from 'expo-network';

/**
 * Forget packs for sites the person is no longer on.
 * Download current revisions on Wi-Fi, and delete superseded files on every successful sync.
 */
export async function syncAssignedPacks(isActive: () => boolean = () => true): Promise<void> {
  const assigned = await repo.listAssignedSites();
  if (!isActive()) return;
  for (const siteId of siteIdsToDrop(
    cachedPackSiteIds(),
    assigned.map((site) => site.id)
  )) {
    if (!isActive()) return;
    await deleteSiteCache(siteId);
  }
  let onWifi = false;
  try {
    const state = await Network.getNetworkStateAsync();
    onWifi = downloadsOnWifi(state.type);
  } catch {
    onWifi = false;
  }
  if (!isActive() || !onWifi) return;
  for (const site of assigned) {
    if (!isActive()) return;
    try {
      const manifest = await repo.sitePackManifest(site.id);
      if (!isActive()) return;
      if (manifest.length === 0) {
        await deleteSiteCache(site.id);
        continue;
      }
      const currentIds = manifest.map((item) => item.drawing_id);
      if (packNeedsDownload(readPackMeta(site.id), manifest)) {
        await downloadCurrentPack(site.id, manifest);
      } else {
        await deleteSupersededDrawings(site.id, currentIds);
      }
    } catch {
      // This site stays as it was. The next sync tries again.
    }
  }
}
