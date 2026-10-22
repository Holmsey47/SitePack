import { newId } from '@/data/newId';
import type { Role } from '@/data/types';
import type {
  CreateVariationInput,
  VariationDetail,
  VariationList,
  VariationPhoto,
  VariationStatus,
  VariationVersion,
} from '@/data/variations';
import { pngDataUrl, solidPng, strokesToPngDataUrl } from '@/lib/signaturePng';
import { variationConfirmation } from '@/lib/variationWording';

type Actor = { id: string; role: Role; company_id: string };

type VariationRow = {
  id: string;
  site_id: string;
  company_id: string;
  vo_seq: number;
  created_by: string;
  created_at: string;
};

type VersionRow = {
  id: string;
  variation_id: string;
  site_id: string;
  version_no: number;
  title: string;
  description: string;
  level_area: string | null;
  quantity_text: string | null;
  value_pence: number | null;
  status: VariationStatus;
  is_current: boolean;
  created_by: string;
  created_at: string;
  locked_at: string | null;
};

type PhotoRow = {
  id: string;
  version_id: string;
  site_id: string;
  storage_path: string;
  sort_order: number;
  content_type: string;
  file_size_bytes: number;
};

type SignatureRow = {
  version_id: string;
  site_id: string;
  signer_name: string;
  signer_role: string;
  signer_company: string;
  confirmation_text: string;
  signature_png: string;
  signed_at: string;
  recorded_by: string;
};

export type FixtureVariationBucket = {
  variations: VariationRow[];
  versions: VersionRow[];
  photos: PhotoRow[];
  signatures: SignatureRow[];
  blobs: Record<string, string>;
};

function textField(value: string | null | undefined, max: number, required: boolean): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    if (required) throw new Error('invalid_input');
    return null;
  }
  if (trimmed.length > max) throw new Error('invalid_input');
  return trimmed;
}

function assertPhotos(photos: CreateVariationInput['photos']) {
  if (photos.length < 1 || photos.length > 10) throw new Error('photo_count');
}

export function seedFixtureVariations(input: {
  companyId: string;
  oakId: string;
  warehouseId: string;
  amyId: string;
  cmId: string;
}): FixtureVariationBucket {
  const bucket: FixtureVariationBucket = {
    variations: [],
    versions: [],
    photos: [],
    signatures: [],
    blobs: {},
  };
  const bead = pngDataUrl(solidPng(24, 24, [232, 184, 74]));
  const reveal = pngDataUrl(solidPng(24, 24, [47, 111, 150]));
  const mastic = pngDataUrl(solidPng(24, 24, [90, 140, 90]));
  const yard = pngDataUrl(solidPng(24, 24, [120, 120, 120]));
  const signature = strokesToPngDataUrl([
    [
      { x: 20, y: 80 },
      { x: 80, y: 40 },
      { x: 140, y: 110 },
      { x: 220, y: 50 },
    ],
  ]);

  function add(row: {
    siteId: string;
    vo: number;
    title: string;
    description: string;
    level: string | null;
    quantity: string | null;
    value: number | null;
    status: VariationStatus;
    createdBy: string;
    createdAt: string;
    photos: Array<{ path: string; url: string }>;
    signature?: { name: string; role: string; company: string; png: string; at: string };
  }) {
    const variationId = newId();
    const versionId = newId();
    bucket.variations.push({
      id: variationId,
      site_id: row.siteId,
      company_id: input.companyId,
      vo_seq: row.vo,
      created_by: row.createdBy,
      created_at: row.createdAt,
    });
    bucket.versions.push({
      id: versionId,
      variation_id: variationId,
      site_id: row.siteId,
      version_no: 1,
      title: row.title,
      description: row.description,
      level_area: row.level,
      quantity_text: row.quantity,
      value_pence: row.value,
      status: row.status,
      is_current: true,
      created_by: row.createdBy,
      created_at: row.createdAt,
      locked_at: row.signature?.at ?? null,
    });
    row.photos.forEach((photo, index) => {
      bucket.blobs[photo.path] = photo.url;
      bucket.photos.push({
        id: newId(),
        version_id: versionId,
        site_id: row.siteId,
        storage_path: photo.path,
        sort_order: index + 1,
        content_type: 'image/png',
        file_size_bytes: 80,
      });
    });
    if (row.signature) {
      bucket.signatures.push({
        version_id: versionId,
        site_id: row.siteId,
        signer_name: row.signature.name,
        signer_role: row.signature.role,
        signer_company: row.signature.company,
        confirmation_text: variationConfirmation(row.signature.company, row.value != null),
        signature_png: row.signature.png,
        signed_at: row.signature.at,
        recorded_by: row.createdBy,
      });
    }
  }

  add({
    siteId: input.oakId,
    vo: 1,
    title: 'Extra beads to window reveals',
    description: 'Additional beads where the lining meets the window.',
    level: 'L2',
    quantity: '12 m',
    value: null,
    status: 'Draft',
    createdBy: input.amyId,
    createdAt: '2026-10-22T08:30:00.000Z',
    photos: [
      { path: `${input.companyId}/${input.oakId}/variations/bead.png`, url: bead },
      { path: `${input.companyId}/${input.oakId}/variations/reveal.png`, url: reveal },
    ],
  });
  add({
    siteId: input.oakId,
    vo: 2,
    title: 'Additional mastic',
    description: 'Mastic to the screen head.',
    level: 'Ground',
    quantity: '1 hour',
    value: 18000,
    status: 'Signed',
    createdBy: input.amyId,
    createdAt: '2026-10-22T11:15:00.000Z',
    photos: [{ path: `${input.companyId}/${input.oakId}/variations/mastic.png`, url: mastic }],
    signature: {
      name: 'Dave Moran',
      role: 'Site manager',
      company: 'Northbuild',
      png: signature,
      at: '2026-10-22T13:05:00.000Z',
    },
  });
  add({
    siteId: input.warehouseId,
    vo: 1,
    title: 'Yard gate',
    description: 'Extra leaf on the yard gate.',
    level: null,
    quantity: null,
    value: null,
    status: 'Draft',
    createdBy: input.cmId,
    createdAt: '2026-10-20T09:00:00.000Z',
    photos: [{ path: `${input.companyId}/${input.warehouseId}/variations/yard.png`, url: yard }],
  });
  return bucket;
}

function requireSite(actor: Actor, siteCompanyId: string | undefined, canAccess: boolean) {
  if (!siteCompanyId || siteCompanyId !== actor.company_id || !canAccess) throw new Error('not_authorized');
}

function currentVersion(bucket: FixtureVariationBucket, versionId: string): VersionRow {
  const row = bucket.versions.find((version) => version.id === versionId);
  if (!row) throw new Error('not_authorized');
  return row;
}

function toVersion(bucket: FixtureVariationBucket, row: VersionRow): VariationVersion {
  const photos = bucket.photos
    .filter((photo) => photo.version_id === row.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((photo) => ({
      id: photo.id,
      storage_path: photo.storage_path,
      content_type: photo.content_type,
      file_size_bytes: photo.file_size_bytes,
      sort_order: photo.sort_order,
      signed_url: bucket.blobs[photo.storage_path] ?? null,
      signed_url_expires_at: new Date(Date.now() + 300_000).toISOString(),
    }));
  const signature = bucket.signatures.find((item) => item.version_id === row.id) ?? null;
  return {
    version_id: row.id,
    version_no: row.version_no,
    title: row.title,
    description: row.description,
    level_area: row.level_area,
    quantity_text: row.quantity_text,
    value_pence: row.value_pence,
    status: row.status,
    is_current: row.is_current,
    created_at: row.created_at,
    locked_at: row.locked_at,
    photo_count: photos.length,
    photos,
    signature: signature
      ? {
          signer_name: signature.signer_name,
          signer_role: signature.signer_role,
          signer_company: signature.signer_company,
          confirmation_text: signature.confirmation_text,
          signature_png: signature.signature_png,
          signed_at: signature.signed_at,
        }
      : null,
  };
}

export function fixtureListVariations(
  bucket: FixtureVariationBucket,
  actor: Actor,
  siteId: string,
  siteCompanyId: string | undefined,
  canAccess: boolean
): VariationList {
  requireSite(actor, siteCompanyId, canAccess);
  const rows = bucket.variations
    .filter((row) => row.site_id === siteId)
    .map((row) => {
      const version = bucket.versions.find((item) => item.variation_id === row.id && item.is_current);
      if (!version) throw new Error('not_authorized');
      const view = toVersion(bucket, version);
      return {
        variation_id: row.id,
        version_id: view.version_id,
        vo_seq: row.vo_seq,
        version_no: view.version_no,
        title: view.title,
        status: view.status,
        photo_count: view.photo_count,
        value_pence: view.value_pence,
        created_at: view.created_at,
      };
    })
    .sort((a, b) => a.vo_seq - b.vo_seq);
  return {
    open_count: rows.filter((row) => row.status === 'Draft').length,
    signed_count: rows.filter((row) => row.status === 'Signed' || row.status === 'Sent').length,
    rows,
  };
}

export function fixtureVariationDetail(
  bucket: FixtureVariationBucket,
  actor: Actor,
  variationId: string,
  canAccessSite: (siteId: string) => boolean,
  siteCompany: (siteId: string) => string | undefined
): VariationDetail | null {
  const variation = bucket.variations.find((row) => row.id === variationId);
  if (!variation || variation.company_id !== actor.company_id || !canAccessSite(variation.site_id)) return null;
  if (siteCompany(variation.site_id) !== actor.company_id) return null;
  const versions = bucket.versions.filter((row) => row.variation_id === variation.id);
  const current = versions.find((row) => row.is_current);
  if (!current) return null;
  return {
    variation_id: variation.id,
    site_id: variation.site_id,
    vo_seq: variation.vo_seq,
    current: toVersion(bucket, current),
    history: versions
      .filter((row) => !row.is_current)
      .sort((a, b) => b.version_no - a.version_no)
      .map((row) => toVersion(bucket, row)),
  };
}

export function fixtureCreateVariation(
  bucket: FixtureVariationBucket,
  actor: Actor,
  input: CreateVariationInput,
  siteCompanyId: string | undefined,
  canAccess: boolean
): { variationId: string; versionId: string; voSeq: number } {
  requireSite(actor, siteCompanyId, canAccess);
  if (input.valuePence != null && actor.role !== 'owner' && actor.role !== 'cm') throw new Error('value_not_allowed');
  const title = textField(input.title, 120, true);
  const description = textField(input.description, 2000, false) ?? '';
  const level = textField(input.levelArea, 80, false);
  const quantity = textField(input.quantityText, 80, false);
  assertPhotos(input.photos);
  const voSeq = (bucket.variations.filter((row) => row.site_id === input.siteId).reduce((max, row) => Math.max(max, row.vo_seq), 0) || 0) + 1;
  const variationId = newId();
  const versionId = newId();
  const now = new Date().toISOString();
  bucket.variations.push({
    id: variationId,
    site_id: input.siteId,
    company_id: actor.company_id,
    vo_seq: voSeq,
    created_by: actor.id,
    created_at: now,
  });
  bucket.versions.push({
    id: versionId,
    variation_id: variationId,
    site_id: input.siteId,
    version_no: 1,
    title: title ?? '',
    description,
    level_area: level,
    quantity_text: quantity,
    value_pence: input.valuePence ?? null,
    status: 'Draft',
    is_current: true,
    created_by: actor.id,
    created_at: now,
    locked_at: null,
  });
  input.photos.forEach((photo, index) => {
    bucket.photos.push({
      id: newId(),
      version_id: versionId,
      site_id: input.siteId,
      storage_path: photo.storagePath,
      sort_order: index + 1,
      content_type: photo.contentType,
      file_size_bytes: photo.fileSizeBytes,
    });
  });
  return { variationId, versionId, voSeq };
}

export function fixtureSetVariationValue(
  bucket: FixtureVariationBucket,
  actor: Actor,
  versionId: string,
  valuePence: number | null,
  canAccessSite: (siteId: string) => boolean
) {
  if (actor.role !== 'owner' && actor.role !== 'cm') throw new Error('value_not_allowed');
  const row = currentVersion(bucket, versionId);
  if (!canAccessSite(row.site_id)) throw new Error('not_authorized');
  if (row.status !== 'Draft' || !row.is_current) throw new Error('variation_locked');
  row.value_pence = valuePence;
}

export function fixtureSignVariation(
  bucket: FixtureVariationBucket,
  actor: Actor,
  versionId: string,
  input: { signerName: string; role: string; company: string; confirmationText: string; signaturePng: string },
  canAccessSite: (siteId: string) => boolean
) {
  const row = currentVersion(bucket, versionId);
  if (!canAccessSite(row.site_id)) throw new Error('not_authorized');
  if (row.status !== 'Draft' || !row.is_current) throw new Error('variation_locked');
  const name = input.signerName.trim();
  const role = input.role.trim();
  const company = input.company.trim();
  const confirmation = input.confirmationText.trim();
  if (!name || !role || !company || !confirmation || !input.signaturePng.startsWith('data:image/png;base64,')) {
    throw new Error('invalid_input');
  }
  const signedAt = new Date().toISOString();
  bucket.signatures.push({
    version_id: row.id,
    site_id: row.site_id,
    signer_name: name,
    signer_role: role,
    signer_company: company,
    confirmation_text: confirmation,
    signature_png: input.signaturePng,
    signed_at: signedAt,
    recorded_by: actor.id,
  });
  row.status = 'Signed';
  row.locked_at = signedAt;
}

export function fixtureReviseVariation(
  bucket: FixtureVariationBucket,
  actor: Actor,
  versionId: string,
  canAccessSite: (siteId: string) => boolean
): { versionId: string } {
  const row = currentVersion(bucket, versionId);
  if (!canAccessSite(row.site_id)) throw new Error('not_authorized');
  if (!row.is_current || (row.status !== 'Signed' && row.status !== 'Sent')) throw new Error('variation_locked');
  row.is_current = false;
  const nextId = newId();
  bucket.versions.push({
    ...row,
    id: nextId,
    version_no: row.version_no + 1,
    value_pence: actor.role === 'owner' || actor.role === 'cm' ? row.value_pence : null,
    status: 'Draft',
    is_current: true,
    created_by: actor.id,
    created_at: new Date().toISOString(),
    locked_at: null,
  });
  for (const photo of bucket.photos.filter((item) => item.version_id === row.id)) {
    bucket.photos.push({ ...photo, id: newId(), version_id: nextId });
  }
  return { versionId: nextId };
}

export function fixtureSendVariation(
  bucket: FixtureVariationBucket,
  actor: Actor,
  versionId: string,
  canAccessSite: (siteId: string) => boolean
) {
  if (actor.role !== 'owner' && actor.role !== 'cm') throw new Error('not_authorized');
  const row = currentVersion(bucket, versionId);
  if (!canAccessSite(row.site_id)) throw new Error('not_authorized');
  if (row.status !== 'Signed' || !row.is_current) throw new Error('variation_locked');
  row.status = 'Sent';
}

export function fixtureUpdateDraft(
  bucket: FixtureVariationBucket,
  actor: Actor,
  versionId: string,
  input: { title: string; description: string; levelArea?: string | null; quantityText?: string | null; photos: CreateVariationInput['photos'] },
  canAccessSite: (siteId: string) => boolean
) {
  const row = currentVersion(bucket, versionId);
  if (!canAccessSite(row.site_id)) throw new Error('not_authorized');
  if (row.status !== 'Draft' || !row.is_current) throw new Error('variation_locked');
  row.title = textField(input.title, 120, true) ?? row.title;
  row.description = textField(input.description, 2000, false) ?? '';
  row.level_area = textField(input.levelArea, 80, false);
  row.quantity_text = textField(input.quantityText, 80, false);
  assertPhotos(input.photos);
  bucket.photos = bucket.photos.filter((photo) => photo.version_id !== row.id);
  input.photos.forEach((photo, index) => {
    bucket.photos.push({
      id: newId(),
      version_id: row.id,
      site_id: row.site_id,
      storage_path: photo.storagePath,
      sort_order: index + 1,
      content_type: photo.contentType,
      file_size_bytes: photo.fileSizeBytes,
    });
  });
  void actor;
}

export function fixtureUploadPhoto(
  bucket: FixtureVariationBucket,
  companyId: string,
  siteId: string,
  bytes: Uint8Array,
  contentType: string
): { storagePath: string; fileSizeBytes: number; contentType: string } {
  const storagePath = `${companyId}/${siteId}/variations/${newId()}`;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const base64 = typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(binary);
  bucket.blobs[storagePath] = `data:${contentType};base64,${base64}`;
  return { storagePath, fileSizeBytes: bytes.byteLength, contentType };
}

export function fixturePhotoUrl(bucket: FixtureVariationBucket, storagePath: string): { url: string; expiresAt: string } | null {
  const url = bucket.blobs[storagePath];
  if (!url) return null;
  return { url, expiresAt: new Date(Date.now() + 300_000).toISOString() };
}

export type { VariationPhoto };
