import { repo } from '@/data/index';
import type { QueuedVariation } from '@/lib/variationQueue';

export async function sendQueuedVariation(item: QueuedVariation): Promise<void> {
  const photos = [];
  for (const photo of item.photos) {
    const uploaded = await repo.uploadSitePhoto({
      companyId: item.companyId,
      siteId: item.siteId,
      bytes: photo.bytes,
      contentType: photo.contentType,
    });
    photos.push({
      storagePath: uploaded.storagePath,
      contentType: uploaded.contentType,
      fileSizeBytes: uploaded.fileSizeBytes,
    });
  }
  await repo.createVariation({
    siteId: item.siteId,
    title: item.title,
    description: item.description,
    levelArea: item.levelArea,
    quantityText: item.quantityText,
    valuePence: item.valuePence,
    photos,
  });
}
