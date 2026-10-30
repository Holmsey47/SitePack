import type { Role } from '@/data/types';
import { isRawNetworkText, OFFLINE_COME_BACK } from '@/lib/offlineCopy';

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

export type SnagSignoffKind = 'internal' | 'contractor';

export type SnagSnapshot = {
  snag_id: string;
  snag_seq: number;
  note: string;
  level_area: string | null;
  status?: string;
  photo_paths?: string[];
};

export type SnagSignature = {
  kind: SnagSignoffKind;
  signer_name: string;
  signer_role: string;
  signer_company: string;
  confirmation_text: string;
  signature_png: string | null;
  signed_at: string;
  signed_received_at: string;
  signoff_id: string;
};

export type SnagSignoff = {
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
  covered: SnagSnapshot[];
  outstanding: SnagSnapshot[];
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
  snagId: string;
  siteId: string;
  note: string;
  levelArea?: string | null;
  tradeLabel: string;
  raisedAt: string;
  photos: SnagPhotoInput[];
};

export type CreateSnagResult = {
  snagId: string;
  snagSeq: number;
  alreadyExisted?: boolean;
  photoPaths?: string[];
};

export type SignOffSnagsInput = {
  signoffId: string;
  siteId: string;
  signedAt: string;
  company: string;
  signerName?: string;
  signerRole?: string;
  signaturePng?: string;
  coveredIds: string[];
  outstandingIds: string[];
};

export function snagNumber(snagSeq: number): string {
  return `S-${snagSeq}`;
}

export function canSignOffSnag(role: Role): boolean {
  return role === 'owner' || role === 'cm';
}

export function snagRoleLabel(role: Role): string {
  if (role === 'owner') return 'Owner';
  if (role === 'cm') return 'Site manager';
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

/** Shown beside a disabled Mark fixed button, and when the server rejects a fix with no after photo. */
export const MARK_FIXED_NEEDS_PHOTO = 'Add a photo of the fix first.';
export const MARK_FIXED_PHOTO_COUNT = 'Add between 1 and 10 photos.';
export const MARK_FIXED_SIGN_IN = 'Sign in again before marking this fixed.';
export const MARK_FIXED_NOT_ON_SITE = 'You are not on this site.';
export const MARK_FIXED_ROLE = 'Your role cannot mark a snag fixed.';
export const MARK_FIXED_SIGN_OFF_PENDING = 'A sign-off is already waiting to send.';
export const MARK_FIXED_SIGNED_OFF = 'This snag is already signed off.';
export const MARK_FIXED_ALREADY = 'This snag is already marked fixed.';
export const MARK_FIXED_SAVING = 'Saving the fix…';

export function snagError(code: string): string {
  switch (code) {
    case 'snag_locked':
      return MARK_FIXED_SIGNED_OFF;
    case 'after_photo_required':
      return MARK_FIXED_NEEDS_PHOTO;
    case 'photo_count':
      return MARK_FIXED_PHOTO_COUNT;
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
    case 'snag_list_changed':
      return 'The snag list changed before this sign-off was sent. Please sign again.';
    case 'closed':
      return 'Nothing is left to sign off.';
    case 'not_found':
      return 'That snag could not be found.';
    case 'invalid_input':
      return 'Check the snag and try again.';
    default:
      if (isRawNetworkText(code)) return OFFLINE_COME_BACK;
      return code === 'unknown' ? 'Could not save the snag.' : code;
  }
}

/**
 * Why Mark fixed is disabled, or null when it can be pressed.
 * The server still requires 1–10 after photos. Role is not a block for owner, contracts manager, or operative.
 */
export function markFixedDisabledReason(input: {
  signedIn: boolean;
  role: Role | null;
  /** False when this person cannot open the site. A loaded snag has already passed that check. */
  assigned: boolean;
  status: SnagStatus;
  afterPhotoCount: number;
  saving: boolean;
  signOffPending: boolean;
}): string | null {
  if (!input.signedIn) return MARK_FIXED_SIGN_IN;
  if (!input.assigned) return MARK_FIXED_NOT_ON_SITE;
  if (input.role !== 'owner' && input.role !== 'cm' && input.role !== 'operative') return MARK_FIXED_ROLE;
  if (input.status === 'Signed off') return MARK_FIXED_SIGNED_OFF;
  if (input.status === 'Fixed' && input.signOffPending) return MARK_FIXED_SIGN_OFF_PENDING;
  if (input.status === 'Fixed') return MARK_FIXED_ALREADY;
  if (input.saving) return MARK_FIXED_SAVING;
  if (input.afterPhotoCount < 1) return MARK_FIXED_NEEDS_PHOTO;
  if (input.afterPhotoCount > 10) return MARK_FIXED_PHOTO_COUNT;
  return null;
}
