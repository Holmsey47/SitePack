import type { Role } from '@/data/types';

export const SNAG_STATUSES = ['Open', 'Fixed', 'Signed off'] as const;
export type SnagStatus = (typeof SNAG_STATUSES)[number];
export type SnagStatusFilter = 'All' | SnagStatus;
export type SnagLevelFilter = 'All' | string;

export type SnagSummary = {
  snag_id: string;
  snag_seq: number;
  note: string;
  level_area: string | null;
  trade_label: string;
  status: SnagStatus;
  raised_by_name: string;
  raised_at: string;
  before_count: number;
  after_count: number;
};

export type SnagList = {
  open_count: number;
  fixed_count: number;
  signed_off_count: number;
  rows: SnagSummary[];
};

export type SnagPhoto = {
  id: string;
  kind: 'before' | 'after';
  storage_path: string;
  content_type: string;
  file_size_bytes: number;
  sort_order: number;
  signed_url?: string | null;
  signed_url_expires_at?: string | null;
};

export type SnagSignature = {
  kind: 'manager' | 'contractor';
  signer_name: string;
  signer_role: string;
  signer_company: string;
  signature_png: string | null;
  signed_at: string;
  signed_received_at: string;
};

export type SnagDetail = {
  snag_id: string;
  site_id: string;
  snag_seq: number;
  note: string;
  level_area: string | null;
  trade_label: string;
  status: SnagStatus;
  raised_by_name: string;
  raised_at: string;
  raised_received_at: string;
  fixed_by_name: string | null;
  fixed_at: string | null;
  fixed_received_at: string | null;
  photos: SnagPhoto[];
  signature: SnagSignature | null;
};

export type SnagReport = {
  rows: SnagDetail[];
};

export type SnagPhotoInput = {
  storagePath: string;
  contentType: string;
  fileSizeBytes: number;
};

export type CreateSnagInput = {
  siteId: string;
  note: string;
  levelArea?: string | null;
  tradeLabel: string;
  raisedAt: string;
  photos: SnagPhotoInput[];
};

export function snagNumber(snagSeq: number): string {
  return `S-${snagSeq}`;
}

export function canSignOffSnag(role: Role): boolean {
  return role === 'owner' || role === 'cm';
}

export function snagRoleLabel(role: Role): string {
  if (role === 'owner') return 'Owner';
  if (role === 'cm') return 'Contracts manager';
  return 'Operative';
}

export function filterSnags(rows: SnagSummary[], status: SnagStatusFilter, level: SnagLevelFilter): SnagSummary[] {
  return rows.filter((row) => {
    if (status !== 'All' && row.status !== status) return false;
    if (level !== 'All' && (row.level_area ?? '') !== level) return false;
    return true;
  });
}

export function snagLevels(rows: Array<{ level_area: string | null }>): string[] {
  const levels = new Set<string>();
  for (const row of rows) {
    const level = row.level_area?.trim();
    if (level) levels.add(level);
  }
  return [...levels].sort((a, b) => a.localeCompare(b, 'en-GB'));
}

export function filterSnagDetails(rows: SnagDetail[], status: SnagStatusFilter, level: SnagLevelFilter): SnagDetail[] {
  return rows.filter((row) => {
    if (status !== 'All' && row.status !== status) return false;
    if (level !== 'All' && (row.level_area ?? '') !== level) return false;
    return true;
  });
}

export function snagError(code: string): string {
  switch (code) {
    case 'snag_locked':
      return 'This snag is already signed off.';
    case 'after_photo_required':
      return 'Add an after photo before marking it fixed.';
    case 'photo_count':
      return 'Add between 1 and 10 photos.';
    case 'photo_too_large':
      return 'Each photo must be 1.5MB or smaller.';
    case 'invalid_path':
      return 'That photo could not be stored on this site.';
    case 'invalid_time':
      return 'The phone time looks wrong. Check the clock and try again.';
    case 'not_authorized':
      return 'You cannot open this snag.';
    case 'signature_required':
      return 'Sign off needs a name and a signature.';
    case 'invalid_input':
      return 'Check the snag and try again.';
    default:
      return code === 'unknown' ? 'Could not save the snag.' : code;
  }
}
