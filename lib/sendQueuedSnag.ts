import type { CreateSnagInput, SnagPhotoInput, SnagSignoff } from '@/data/snags';
import type { QueuedPhoto, QueuedSnag, QueuedSnagCreate, QueuedSnagFix, SnagQueueStore } from '@/lib/snagQueue';
import { getSnagQueue } from '@/lib/snagQueue';

export type SnagSender = {
  upload(photo: QueuedPhoto, item: { companyId: string; siteId: string }): Promise<SnagPhotoInput>;
  create(input: CreateSnagInput): Promise<{ snagId: string; alreadyExisted?: boolean; photoPaths?: string[] }>;
  fix(snagId: string, fixedAt: string, photos: SnagPhotoInput[], fixId?: string | null): Promise<void>;
  signInternal(input: {
    signoffId: string;
    siteId: string;
    signedAt: string;
    company: string;
    coveredIds: string[];
    outstandingIds: string[];
  }): Promise<SnagSignoff>;
  signContractor(input: {
    signoffId: string;
    siteId: string;
    signedAt: string;
    signerName: string;
    signerRole: string;
    company: string;
    signaturePng: string;
    coveredIds: string[];
    outstandingIds: string[];
  }): Promise<SnagSignoff>;
  removePhotos?(storagePaths: string[]): Promise<void>;
};

async function defaultSender(): Promise<SnagSender> {
  const { repo } = await import('@/data/index');
  return {
    async upload(photo, item) {
      const uploaded = await repo.uploadSitePhoto({
        companyId: item.companyId,
        siteId: item.siteId,
        bytes: photo.bytes,
        contentType: photo.contentType,
        folder: 'snags',
      });
      return {
        storagePath: uploaded.storagePath,
        contentType: uploaded.contentType,
        fileSizeBytes: uploaded.fileSizeBytes,
      };
    },
    async create(input) {
      const created = await repo.createSnag(input);
      return { snagId: created.snagId, alreadyExisted: created.alreadyExisted, photoPaths: created.photoPaths };
    },
    async fix(snagId, fixedAt, photos, fixId) {
      await repo.fixSnag(snagId, fixedAt, photos, fixId);
    },
    async signInternal(input) {
      return repo.signOffSnagsInternal(input);
    },
    async signContractor(input) {
      return repo.signOffSnagsContractor(input);
    },
    async removePhotos(storagePaths) {
      await repo.removeSitePhotos(storagePaths);
    },
  };
}

async function uploadAll(sender: SnagSender, photos: QueuedPhoto[], item: { companyId: string; siteId: string }) {
  const uploaded: SnagPhotoInput[] = [];
  for (const photo of photos) uploaded.push(await sender.upload(photo, item));
  return uploaded;
}

/** Reuse paths already stored on the queue. A fresh upload is saved before the write. */
async function photosFor(
  sender: SnagSender,
  item: QueuedSnagCreate | QueuedSnagFix,
  queue: SnagQueueStore
): Promise<SnagPhotoInput[]> {
  if (item.uploadedPhotos && item.uploadedPhotos.length > 0) return item.uploadedPhotos;
  const photos = await uploadAll(sender, item.photos, item);
  await queue.put({ ...item, uploadedPhotos: photos });
  return photos;
}

async function dropOrphanPhotos(sender: SnagSender, sent: SnagPhotoInput[], kept: string[] | undefined) {
  if (!sender.removePhotos) return;
  const stored = new Set(kept ?? []);
  const orphans = sent.map((photo) => photo.storagePath).filter((path) => path.length > 0 && !stored.has(path));
  if (orphans.length < 1) return;
  try {
    await sender.removePhotos(orphans);
  } catch {
    // A lost create already saved the snag. A denied delete must not keep the queue item.
  }
}

export async function sendQueuedSnag(
  item: QueuedSnag,
  sender?: SnagSender,
  queue: SnagQueueStore = getSnagQueue()
): Promise<void> {
  const active = sender ?? (await defaultSender());
  if (item.kind === 'create') {
    let current: QueuedSnagCreate = item;
    if (!current.serverSnagId) {
      const photos = await photosFor(active, current, queue);
      const created = await active.create({
        snagId: current.localId,
        siteId: current.siteId,
        note: current.note,
        levelArea: current.levelArea,
        tradeLabel: current.tradeLabel,
        raisedAt: current.raisedAt,
        photos,
      });
      if (created.alreadyExisted && created.photoPaths) await dropOrphanPhotos(active, photos, created.photoPaths);
      current = { ...current, serverSnagId: created.snagId, uploadedPhotos: photos };
      await queue.put(current);
    }
    return;
  }

  if (item.kind === 'fix') {
    const photos = await photosFor(active, item, queue);
    await active.fix(item.snagId, item.fixedAt, photos, item.localId);
    return;
  }

  if (item.mode === 'internal') {
    await active.signInternal({
      signoffId: item.localId,
      siteId: item.siteId,
      signedAt: item.signedAt,
      company: item.signerCompany,
      coveredIds: item.coveredIds,
      outstandingIds: item.outstandingIds,
    });
    return;
  }

  await active.signContractor({
    signoffId: item.localId,
    siteId: item.siteId,
    signedAt: item.signedAt,
    signerName: item.signerName ?? '',
    signerRole: item.signerRole ?? '',
    company: item.signerCompany,
    signaturePng: item.signaturePng ?? '',
    coveredIds: item.coveredIds,
    outstandingIds: item.outstandingIds,
  });
}
