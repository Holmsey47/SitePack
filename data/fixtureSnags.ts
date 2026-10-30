import { newId } from '@/data/newId';
import type { Role } from '@/data/types';
import type {
  CreateSnagInput,
  SignOffSnagsInput,
  SnagDetail,
  SnagList,
  SnagPhoto,
  SnagPhotoInput,
  SnagSignoff,
  SnagSignoffKind,
  SnagSnapshot,
  SnagStatus,
  SnagSummary,
} from '@/data/snags';
import { snagRoleLabel } from '@/data/snags';
import { snagConfirmation } from '@/lib/snagWording';
import { snagJpegDataUrl, type SnagJpegName } from '@/lib/snagJpegFixtures';
import { strokesToPngDataUrl } from '@/lib/signaturePng';

const PAST_MS = 30 * 24 * 60 * 60 * 1000;
const FUTURE_MS = 24 * 60 * 60 * 1000;

type Actor = { id: string; role: Role; company_id: string; display_name: string };

type SnagRow = {
  id: string;
  site_id: string;
  company_id: string;
  snag_seq: number;
  note: string;
  level_area: string | null;
  trade_label: string;
  raised_by: string;
  raised_by_name: string;
  raised_at: string;
  raised_received_at: string;
  status: SnagStatus;
  fixed_by: string | null;
  fixed_by_name: string | null;
  fixed_at: string | null;
  fixed_received_at: string | null;
  fixed_client_id?: string | null;
};

type PhotoRow = {
  id: string;
  snag_id: string;
  site_id: string;
  kind: 'before' | 'after';
  storage_path: string;
  sort_order: number;
  content_type: string;
  file_size_bytes: number;
};

type SignatureRow = {
  snag_id: string;
  signoff_id: string;
  site_id: string;
  kind: SnagSignoffKind;
  signer_name: string;
  signer_role: string;
  signer_company: string;
  confirmation_text: string;
  signature_png: string | null;
  signed_at: string;
  signed_received_at: string;
  recorded_by: string;
};

type SignoffRow = {
  id: string;
  site_id: string;
  company_id: string;
  kind: SnagSignoffKind;
  signer_name: string;
  signer_role: string;
  signer_company: string;
  confirmation_text: string;
  signature_png: string | null;
  signed_at: string;
  signed_received_at: string;
  covered: SnagSnapshot[];
  outstanding: SnagSnapshot[];
  recorded_by: string;
};

export type FixtureSnagBucket = {
  snags: SnagRow[];
  photos: PhotoRow[];
  signatures: SignatureRow[];
  signoffs: SignoffRow[];
  blobs: Record<string, string>;
  seq: Record<string, number>;
};

function deviceTime(iso: string): string {
  const at = new Date(iso).getTime();
  const now = Date.now();
  if (Number.isNaN(at) || at > now + FUTURE_MS || at < now - PAST_MS) throw new Error('invalid_time');
  return new Date(at).toISOString();
}

function textField(value: string | null | undefined, max: number, required: boolean): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    if (required) throw new Error('invalid_input');
    return null;
  }
  if (trimmed.length > max) throw new Error('invalid_input');
  return trimmed;
}

function assertPhotos(photos: SnagPhotoInput[]) {
  if (photos.length < 1 || photos.length > 10) throw new Error('photo_count');
  for (const photo of photos) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.contentType)) throw new Error('invalid_input');
    if (photo.fileSizeBytes < 1 || photo.fileSizeBytes > 1_572_864) throw new Error('photo_too_large');
  }
}

function assertPaths(photos: SnagPhotoInput[], companyId: string, siteId: string) {
  const prefix = `${companyId}/${siteId}/snags/`;
  for (const photo of photos) {
    const path = photo.storagePath.trim();
    if (
      path.startsWith('/') ||
      !path.startsWith(prefix) ||
      path.includes('..') ||
      path.includes('\\') ||
      path.includes('//') ||
      /\s/.test(path)
    ) {
      throw new Error('invalid_path');
    }
  }
}

function requireSite(actor: Actor, siteCompanyId: string | undefined, canAccess: boolean) {
  if (!siteCompanyId || siteCompanyId !== actor.company_id || !canAccess) throw new Error('not_authorized');
}

function rowOrThrow(bucket: FixtureSnagBucket, snagId: string): SnagRow {
  const row = bucket.snags.find((snag) => snag.id === snagId);
  if (!row) throw new Error('not_authorized');
  return row;
}

function toSummary(bucket: FixtureSnagBucket, row: SnagRow): SnagSummary {
  const photos = bucket.photos.filter((photo) => photo.snag_id === row.id);
  return {
    snag_id: row.id,
    snag_seq: row.snag_seq,
    note: row.note,
    level_area: row.level_area,
    trade_label: row.trade_label,
    status: row.status,
    raised_by_name: row.raised_by_name,
    raised_at: row.raised_at,
    before_count: photos.filter((photo) => photo.kind === 'before').length,
    after_count: photos.filter((photo) => photo.kind === 'after').length,
  };
}

function toDetail(bucket: FixtureSnagBucket, row: SnagRow): SnagDetail {
  const photos: SnagPhoto[] = bucket.photos
    .filter((photo) => photo.snag_id === row.id)
    .sort((a, b) => (a.kind === b.kind ? a.sort_order - b.sort_order : a.kind === 'before' ? -1 : 1))
    .map((photo) => ({
      id: photo.id,
      kind: photo.kind,
      storage_path: photo.storage_path,
      content_type: photo.content_type,
      file_size_bytes: photo.file_size_bytes,
      sort_order: photo.sort_order,
      signed_url: bucket.blobs[photo.storage_path] ?? null,
      signed_url_expires_at: new Date(Date.now() + 300_000).toISOString(),
    }));
  const signature = bucket.signatures.find((item) => item.snag_id === row.id) ?? null;
  return {
    snag_id: row.id,
    site_id: row.site_id,
    snag_seq: row.snag_seq,
    note: row.note,
    level_area: row.level_area,
    trade_label: row.trade_label,
    status: row.status,
    raised_by_name: row.raised_by_name,
    raised_at: row.raised_at,
    raised_received_at: row.raised_received_at,
    fixed_by_name: row.fixed_by_name,
    fixed_at: row.fixed_at,
    fixed_received_at: row.fixed_received_at,
    photos,
    signature: signature
      ? {
          kind: signature.kind,
          signer_name: signature.signer_name,
          signer_role: signature.signer_role,
          signer_company: signature.signer_company,
          confirmation_text: signature.confirmation_text,
          signature_png: signature.signature_png,
          signed_at: signature.signed_at,
          signed_received_at: signature.signed_received_at,
          signoff_id: signature.signoff_id,
        }
      : null,
  };
}

function takePhotos(bucket: FixtureSnagBucket, snagId: string, siteId: string, kind: 'before' | 'after', photos: SnagPhotoInput[]) {
  photos.forEach((photo, index) => {
    bucket.photos.push({
      id: newId(),
      snag_id: snagId,
      site_id: siteId,
      kind,
      storage_path: photo.storagePath,
      sort_order: index + 1,
      content_type: photo.contentType,
      file_size_bytes: photo.fileSizeBytes,
    });
  });
}

export function seedFixtureSnags(input: { companyId: string; oakId: string; warehouseId: string; amyId: string; benId: string; cmId: string }): FixtureSnagBucket {
  const bucket: FixtureSnagBucket = { snags: [], photos: [], signatures: [], signoffs: [], blobs: {}, seq: {} };
  const signature = strokesToPngDataUrl([
    [
      { x: 16, y: 90 },
      { x: 70, y: 40 },
      { x: 140, y: 110 },
      { x: 240, y: 36 },
    ],
  ]);
  const raised = '2026-10-22T08:15:00.000Z';
  const fixed = '2026-10-22T11:40:00.000Z';
  const signed = '2026-10-22T13:05:00.000Z';

  function add(row: {
    siteId: string;
    note: string;
    level: string | null;
    trade: string;
    status: SnagStatus;
    raisedBy: string;
    raisedByName: string;
    before: SnagJpegName;
    after?: SnagJpegName;
    signature?: { kind: SnagSignoffKind; name: string; role: string; company: string; png: string | null };
  }) {
    const seq = (bucket.seq[row.siteId] ?? 0) + 1;
    bucket.seq[row.siteId] = seq;
    const id = newId();
    const beforePath = `${input.companyId}/${row.siteId}/snags/${id}-before.jpg`;
    bucket.blobs[beforePath] = snagJpegDataUrl(row.before);
    bucket.snags.push({
      id,
      site_id: row.siteId,
      company_id: input.companyId,
      snag_seq: seq,
      note: row.note,
      level_area: row.level,
      trade_label: row.trade,
      raised_by: row.raisedBy,
      raised_by_name: row.raisedByName,
      raised_at: raised,
      raised_received_at: '2026-10-22T08:16:00.000Z',
      status: row.status,
      fixed_by: row.status === 'Open' ? null : row.raisedBy,
      fixed_by_name: row.status === 'Open' ? null : row.raisedByName,
      fixed_at: row.status === 'Open' ? null : fixed,
      fixed_received_at: row.status === 'Open' ? null : '2026-10-22T11:41:00.000Z',
    });
    bucket.photos.push({
      id: newId(),
      snag_id: id,
      site_id: row.siteId,
      kind: 'before',
      storage_path: beforePath,
      sort_order: 1,
      content_type: 'image/jpeg',
      file_size_bytes: 65000,
    });
    if (row.after) {
      const afterPath = `${input.companyId}/${row.siteId}/snags/${id}-after.jpg`;
      bucket.blobs[afterPath] = snagJpegDataUrl(row.after);
      bucket.photos.push({
        id: newId(),
        snag_id: id,
        site_id: row.siteId,
        kind: 'after',
        storage_path: afterPath,
        sort_order: 1,
        content_type: 'image/jpeg',
        file_size_bytes: 68000,
      });
    }
    if (row.signature) {
      const signoffId = newId();
      const confirmation = snagConfirmation(row.signature.company, row.signature.kind, 1);
      const photoPaths = bucket.photos.filter((photo) => photo.snag_id === id).map((photo) => photo.storage_path);
      bucket.signoffs.push({
        id: signoffId,
        site_id: row.siteId,
        company_id: input.companyId,
        kind: row.signature.kind,
        signer_name: row.signature.name,
        signer_role: row.signature.role,
        signer_company: row.signature.company,
        confirmation_text: confirmation,
        signature_png: row.signature.png,
        signed_at: signed,
        signed_received_at: '2026-10-22T13:05:30.000Z',
        covered: [
          {
            snag_id: id,
            snag_seq: seq,
            note: row.note,
            level_area: row.level,
            status: 'Fixed',
            photo_paths: photoPaths,
          },
        ],
        outstanding: [],
        recorded_by: input.cmId,
      });
      bucket.signatures.push({
        snag_id: id,
        signoff_id: signoffId,
        site_id: row.siteId,
        kind: row.signature.kind,
        signer_name: row.signature.name,
        signer_role: row.signature.role,
        signer_company: row.signature.company,
        confirmation_text: confirmation,
        signature_png: row.signature.png,
        signed_at: signed,
        signed_received_at: '2026-10-22T13:05:30.000Z',
        recorded_by: input.cmId,
      });
    }
  }

  const oak = [
    { note: 'Bead missing at the window reveal', level: 'Ground', trade: 'dryliner', status: 'Open' as const, who: input.amyId, name: 'Amy Keane', before: 'beforeWide' as const },
    { note: 'Skirting not fixed in the hall', level: 'Ground', trade: 'labourer', status: 'Open' as const, who: input.benId, name: 'Ben Torres', before: 'bars' as const },
    { note: 'Joint tape lifting by the door', level: 'First', trade: 'dryliner', status: 'Open' as const, who: input.amyId, name: 'Amy Keane', before: 'beforeTall' as const },
    { note: 'Socket box proud of the board', level: 'Second', trade: 'electrician', status: 'Open' as const, who: input.benId, name: 'Ben Torres', before: 'beforeWide' as const },
    { note: 'Crack above the lintel', level: 'Ground', trade: 'dryliner', status: 'Fixed' as const, who: input.amyId, name: 'Amy Keane', before: 'beforeWide' as const, after: 'afterWide' as const },
    { note: 'Door will not close on the latch', level: 'First', trade: 'labourer', status: 'Fixed' as const, who: input.benId, name: 'Ben Torres', before: 'beforeTall' as const, after: 'afterWide' as const },
    {
      note: 'Hole in the plaster by the riser',
      level: 'First',
      trade: 'dryliner',
      status: 'Signed off' as const,
      who: input.amyId,
      name: 'Amy Keane',
      before: 'beforeWide' as const,
      after: 'afterWide' as const,
      signature: { kind: 'internal' as const, name: 'Priya Shah', role: 'Site manager', company: 'Ashfield Finishes', png: null },
    },
    {
      note: 'Stain on the ceiling',
      level: 'Second',
      trade: 'dryliner',
      status: 'Signed off' as const,
      who: input.amyId,
      name: 'Amy Keane',
      before: 'afterWide' as const,
      after: 'beforeWide' as const,
      signature: { kind: 'contractor' as const, name: 'Dave Moran', role: 'Site manager', company: 'Northbuild', png: signature },
    },
    {
      note: 'Board joint open in the corridor',
      level: 'Ground',
      trade: 'labourer',
      status: 'Signed off' as const,
      who: input.benId,
      name: 'Ben Torres',
      before: 'bars' as const,
      after: 'afterWide' as const,
      signature: { kind: 'internal' as const, name: 'Priya Shah', role: 'Site manager', company: 'Ashfield Finishes', png: null },
    },
    { note: 'Tidy the offcuts by the stairs', level: 'Second', trade: 'labourer', status: 'Open' as const, who: input.benId, name: 'Ben Torres', before: 'bars' as const },
  ];

  for (const row of oak) {
    add({
      siteId: input.oakId,
      note: row.note,
      level: row.level,
      trade: row.trade,
      status: row.status,
      raisedBy: row.who,
      raisedByName: row.name,
      before: row.before,
      after: 'after' in row ? row.after : undefined,
      signature: 'signature' in row ? row.signature : undefined,
    });
  }

  add({
    siteId: input.warehouseId,
    note: 'Yard gate catch is loose',
    level: 'Yard',
    trade: 'labourer',
    status: 'Open',
    raisedBy: input.cmId,
    raisedByName: 'Priya Shah',
    before: 'bars',
  });

  return bucket;
}

export function fixtureListSnags(
  bucket: FixtureSnagBucket,
  actor: Actor,
  siteId: string,
  siteCompanyId: string | undefined,
  canAccess: boolean
): SnagList {
  requireSite(actor, siteCompanyId, canAccess);
  const rows = bucket.snags
    .filter((snag) => snag.site_id === siteId && snag.company_id === actor.company_id)
    .sort((a, b) => a.snag_seq - b.snag_seq)
    .map((snag) => toSummary(bucket, snag));
  return {
    open_count: rows.filter((row) => row.status === 'Open').length,
    fixed_count: rows.filter((row) => row.status === 'Fixed').length,
    signed_off_count: rows.filter((row) => row.status === 'Signed off').length,
    rows,
  };
}

export function fixtureSnagDetail(
  bucket: FixtureSnagBucket,
  actor: Actor,
  snagId: string,
  canAccessSite: (siteId: string) => boolean,
  siteCompany: (siteId: string) => string | undefined
): SnagDetail | null {
  const row = bucket.snags.find((snag) => snag.id === snagId);
  if (!row || row.company_id !== actor.company_id || !canAccessSite(row.site_id) || siteCompany(row.site_id) !== actor.company_id) {
    return null;
  }
  return toDetail(bucket, row);
}

export function fixtureSnagReport(
  bucket: FixtureSnagBucket,
  actor: Actor,
  siteId: string,
  siteCompanyId: string | undefined,
  canAccess: boolean
): SnagDetail[] {
  requireSite(actor, siteCompanyId, canAccess);
  return bucket.snags
    .filter((snag) => snag.site_id === siteId && snag.company_id === actor.company_id)
    .sort((a, b) => a.snag_seq - b.snag_seq)
    .map((snag) => toDetail(bucket, snag));
}

export function fixtureCreateSnag(
  bucket: FixtureSnagBucket,
  actor: Actor,
  input: CreateSnagInput,
  siteCompanyId: string | undefined,
  canAccess: boolean
): { snagId: string; snagSeq: number; alreadyExisted: boolean; photoPaths: string[] } {
  requireSite(actor, siteCompanyId, canAccess);
  if (!input.snagId) throw new Error('invalid_input');
  const existing = bucket.snags.find((snag) => snag.id === input.snagId);
  if (existing) {
    if (existing.site_id === input.siteId && existing.company_id === actor.company_id) {
      return {
        snagId: existing.id,
        snagSeq: existing.snag_seq,
        alreadyExisted: true,
        photoPaths: bucket.photos.filter((photo) => photo.snag_id === existing.id).map((photo) => photo.storage_path),
      };
    }
    throw new Error('not_authorized');
  }
  const note = textField(input.note, 2000, true);
  const level = textField(input.levelArea, 80, false);
  const trade = textField(input.tradeLabel, 80, true);
  if (!note || !trade) throw new Error('invalid_input');
  assertPhotos(input.photos);
  assertPaths(input.photos, actor.company_id, input.siteId);
  const raisedAt = deviceTime(input.raisedAt);
  const received = new Date().toISOString();
  const snagSeq = (bucket.seq[input.siteId] ?? 0) + 1;
  bucket.seq[input.siteId] = snagSeq;
  const id = input.snagId;
  bucket.snags.push({
    id,
    site_id: input.siteId,
    company_id: actor.company_id,
    snag_seq: snagSeq,
    note,
    level_area: level,
    trade_label: trade,
    raised_by: actor.id,
    raised_by_name: actor.display_name.trim() || 'Someone on site',
    raised_at: raisedAt,
    raised_received_at: received,
    status: 'Open',
    fixed_by: null,
    fixed_by_name: null,
    fixed_at: null,
    fixed_received_at: null,
  });
  takePhotos(bucket, id, input.siteId, 'before', input.photos);
  return {
    snagId: id,
    snagSeq,
    alreadyExisted: false,
    photoPaths: input.photos.map((photo) => photo.storagePath),
  };
}

export function fixtureFixSnag(
  bucket: FixtureSnagBucket,
  actor: Actor,
  snagId: string,
  fixedAtIso: string,
  photos: SnagPhotoInput[],
  canAccessSite: (siteId: string) => boolean,
  fixId?: string | null
): { alreadyFixed: boolean } {
  const row = rowOrThrow(bucket, snagId);
  if (row.company_id !== actor.company_id || !canAccessSite(row.site_id)) throw new Error('not_authorized');
  if (row.status === 'Fixed' || row.status === 'Signed off') {
    const stored = bucket.photos
      .filter((photo) => photo.snag_id === row.id && photo.kind === 'after')
      .map((photo) => photo.storage_path);
    const given = photos.map((photo) => photo.storagePath);
    const samePaths = stored.length === given.length && stored.every((path, index) => path === given[index]);
    if ((fixId && row.fixed_client_id === fixId) || samePaths) return { alreadyFixed: true };
    throw new Error('snag_locked');
  }
  if (row.status !== 'Open') throw new Error('snag_locked');
  assertPhotos(photos);
  assertPaths(photos, actor.company_id, row.site_id);
  const fixedAt = deviceTime(fixedAtIso);
  takePhotos(bucket, row.id, row.site_id, 'after', photos);
  row.status = 'Fixed';
  row.fixed_by = actor.id;
  row.fixed_by_name = actor.display_name.trim() || 'Someone on site';
  row.fixed_at = fixedAt;
  row.fixed_received_at = new Date().toISOString();
  row.fixed_client_id = fixId ?? null;
  return { alreadyFixed: false };
}

function snapshot(bucket: FixtureSnagBucket, row: SnagRow, status: SnagStatus): SnagSnapshot {
  return {
    snag_id: row.id,
    snag_seq: row.snag_seq,
    note: row.note,
    level_area: row.level_area,
    status,
    photo_paths: bucket.photos.filter((photo) => photo.snag_id === row.id).map((photo) => photo.storage_path),
  };
}

function toSignoff(row: SignoffRow): SnagSignoff {
  return {
    signoff_id: row.id,
    site_id: row.site_id,
    kind: row.kind,
    signer_name: row.signer_name,
    signer_role: row.signer_role,
    signer_company: row.signer_company,
    confirmation_text: row.confirmation_text,
    signature_png: row.signature_png,
    signed_at: row.signed_at,
    signed_received_at: row.signed_received_at,
    covered: row.covered.map((item) => ({ ...item, photo_paths: item.photo_paths ? [...item.photo_paths] : undefined })),
    outstanding: row.outstanding.map((item) => ({ ...item })),
  };
}

export function fixtureSignOffSnags(
  bucket: FixtureSnagBucket,
  actor: Actor,
  input: SignOffSnagsInput,
  kind: SnagSignoffKind,
  canAccessSite: (siteId: string) => boolean,
  siteCompany: (siteId: string) => string | undefined
): SnagSignoff {
  requireSite(actor, siteCompany(input.siteId), canAccessSite(input.siteId));
  const existing = bucket.signoffs.find((row) => row.id === input.signoffId);
  if (existing) {
    if (existing.site_id === input.siteId && existing.company_id === actor.company_id && existing.kind === kind) {
      return toSignoff(existing);
    }
    throw new Error('not_authorized');
  }
  if (kind === 'internal' && actor.role !== 'owner' && actor.role !== 'cm') throw new Error('not_authorized');
  const company = textField(input.company, 120, true);
  if (!company) throw new Error('invalid_input');
  let signerName = actor.display_name.trim() || 'Someone on site';
  let signerRole = snagRoleLabel(actor.role);
  let png: string | null = null;
  if (kind === 'contractor') {
    const name = textField(input.signerName, 120, true);
    const role = textField(input.signerRole, 80, true);
    if (!name || !role || !input.signaturePng?.startsWith('data:image/png;base64,')) throw new Error('invalid_input');
    signerName = name;
    signerRole = role;
    png = input.signaturePng;
  }
  const fixed = bucket.snags.filter((row) => row.site_id === input.siteId && row.company_id === actor.company_id && row.status === 'Fixed');
  const open = bucket.snags.filter((row) => row.site_id === input.siteId && row.company_id === actor.company_id && row.status === 'Open');
  const sameSet = (rows: { id: string }[], ids: string[]) => {
    const left = rows.map((row) => row.id).sort();
    const right = [...ids].sort();
    return left.length === right.length && left.every((id, index) => id === right[index]);
  };
  if (!Array.isArray(input.coveredIds) || !Array.isArray(input.outstandingIds)) throw new Error('invalid_input');
  if (!sameSet(fixed, input.coveredIds) || !sameSet(open, input.outstandingIds)) throw new Error('snag_list_changed');
  if (fixed.length < 1) throw new Error('closed');
  const signedAt = deviceTime(input.signedAt);
  const received = new Date().toISOString();
  const confirmation = snagConfirmation(company, kind, fixed.length);
  const covered = fixed.map((row) => snapshot(bucket, row, 'Fixed'));
  const outstanding = open.map((row) => ({
    snag_id: row.id,
    snag_seq: row.snag_seq,
    note: row.note,
    level_area: row.level_area,
  }));
  const record: SignoffRow = {
    id: input.signoffId,
    site_id: input.siteId,
    company_id: actor.company_id,
    kind,
    signer_name: signerName,
    signer_role: signerRole,
    signer_company: company,
    confirmation_text: confirmation,
    signature_png: png,
    signed_at: signedAt,
    signed_received_at: received,
    covered,
    outstanding,
    recorded_by: actor.id,
  };
  bucket.signoffs.push(record);
  for (const row of fixed) {
    bucket.signatures.push({
      snag_id: row.id,
      signoff_id: input.signoffId,
      site_id: row.site_id,
      kind,
      signer_name: signerName,
      signer_role: signerRole,
      signer_company: company,
      confirmation_text: confirmation,
      signature_png: png,
      signed_at: signedAt,
      signed_received_at: received,
      recorded_by: actor.id,
    });
    row.status = 'Signed off';
  }
  return toSignoff(record);
}

export function fixtureEditSignoff(bucket: FixtureSnagBucket, signoffId: string) {
  const row = bucket.signoffs.find((item) => item.id === signoffId);
  if (!row) throw new Error('not_authorized');
  throw new Error('closed');
}

export function fixtureSnagTrades(
  people: Array<{ id: string; company_id: string; trade: string | null }>,
  assignments: Array<{ site_id: string; person_id: string }>,
  actor: Actor,
  siteId: string,
  siteCompanyId: string | undefined,
  canAccess: boolean
): string[] {
  requireSite(actor, siteCompanyId, canAccess);
  const ids = new Set(assignments.filter((row) => row.site_id === siteId).map((row) => row.person_id));
  const labels = new Set<string>();
  for (const person of people) {
    if (person.company_id !== actor.company_id || !ids.has(person.id)) continue;
    const trade = person.trade?.trim();
    if (trade) labels.add(trade);
  }
  return [...labels].sort((a, b) => a.localeCompare(b, 'en-GB'));
}

export function fixtureUploadSnagPhoto(
  bucket: FixtureSnagBucket,
  companyId: string,
  siteId: string,
  bytes: Uint8Array,
  contentType: string,
  snagId?: string
): { storagePath: string; fileSizeBytes: number; contentType: string } {
  const file = snagId ? `${snagId}/${newId()}` : newId();
  const storagePath = `${companyId}/${siteId}/snags/${file}`;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const base64 = typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(binary);
  bucket.blobs[storagePath] = `data:${contentType};base64,${base64}`;
  return { storagePath, fileSizeBytes: bytes.byteLength, contentType };
}

export function fixtureSnagPhotoUrl(bucket: FixtureSnagBucket, storagePath: string): { url: string; expiresAt: string } | null {
  const url = bucket.blobs[storagePath];
  if (!url) return null;
  return { url, expiresAt: new Date(Date.now() + 300_000).toISOString() };
}
