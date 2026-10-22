import type { CreateSnagInput, SnagPhotoInput } from '@/data/snags';
import type { QueuedPhoto, QueuedSnag, QueuedSnagCreate, SnagQueueStore } from '@/lib/snagQueue';
import { getSnagQueue } from '@/lib/snagQueue';

export type SnagSender = {
  upload(photo: QueuedPhoto, item: { companyId: string; siteId: string }): Promise<SnagPhotoInput>;
  create(input: CreateSnagInput): Promise<{ snagId: string }>;
  fix(snagId: string, fixedAt: string, photos: SnagPhotoInput[]): Promise<void>;
  signManager(snagId: string, signedAt: string): Promise<void>;
  signContractor(snagId: string, signedAt: string, name: string, role: string, company: string, signaturePng: string): Promise<void>;
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
    async signManager(snagId, signedAt) {
      await repo.signOffSnagAsManager(snagId, signedAt);
    },
    async signContractor(snagId, signedAt, name, role, company, signaturePng) {
      await repo.signOffSnagAsContractor(snagId, signedAt, {
        signerName: name,
        signerRole: role,
        signerCompany: company,
        signaturePng,
      });
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

  if (item.mode === 'manager') {
    await active.signManager(item.snagId, item.signedAt);
    return;
  }

  await active.signContractor(
    item.snagId,
    item.signedAt,
    item.signerName ?? '',
    item.signerRole ?? '',
    item.signerCompany ?? '',
    item.signaturePng ?? ''
  );
}
