import type { CreateSnagInput, SnagPhotoInput, SnagSignoff } from '@/data/snags';
import type { QueuedPhoto, QueuedSnag, QueuedSnagCreate, SnagQueueStore } from '@/lib/snagQueue';
import { getSnagQueue } from '@/lib/snagQueue';

export type SnagSender = {
  upload(photo: QueuedPhoto, item: { companyId: string; siteId: string }): Promise<SnagPhotoInput>;
  create(input: CreateSnagInput): Promise<{ snagId: string }>;
  fix(snagId: string, fixedAt: string, photos: SnagPhotoInput[]): Promise<void>;
  signInternal(input: { signoffId: string; siteId: string; signedAt: string; company: string }): Promise<SnagSignoff>;
  signContractor(input: {
    signoffId: string;
    siteId: string;
    signedAt: string;
    signerName: string;
    signerRole: string;
    company: string;
    signaturePng: string;
  }): Promise<SnagSignoff>;
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
      return { snagId: created.snagId };
    },
    async fix(snagId, fixedAt, photos) {
      await repo.fixSnag(snagId, fixedAt, photos);
    },
    async signInternal(input) {
      return repo.signOffSnagsInternal(input);
    },
    async signContractor(input) {
      return repo.signOffSnagsContractor(input);
    },
  };
}

async function uploadAll(sender: SnagSender, photos: QueuedPhoto[], item: { companyId: string; siteId: string }) {
  const uploaded: SnagPhotoInput[] = [];
  for (const photo of photos) uploaded.push(await sender.upload(photo, item));
  return uploaded;
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
      const photos = await uploadAll(active, current.photos, current);
      const created = await active.create({
        snagId: current.localId,
        siteId: current.siteId,
        note: current.note,
        levelArea: current.levelArea,
        tradeLabel: current.tradeLabel,
        raisedAt: current.raisedAt,
        photos,
      });
      current = { ...current, serverSnagId: created.snagId };
      await queue.put(current);
    }
    return;
  }

  if (item.kind === 'fix') {
    const photos = await uploadAll(active, item.photos, item);
    await active.fix(item.snagId, item.fixedAt, photos);
    return;
  }

  if (item.mode === 'internal') {
    await active.signInternal({
      signoffId: item.localId,
      siteId: item.siteId,
      signedAt: item.signedAt,
      company: item.signerCompany,
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
  });
}
