import type { Role } from '@/data/types';

export const PHOTO_URL_SECONDS = 300;
export const VARIATION_STATUSES = ['Draft', 'Signed', 'Sent'] as const;
export type VariationStatus = (typeof VARIATION_STATUSES)[number];
export type VariationFilter = 'All' | VariationStatus;

export type VariationSummary = {
  variation_id: string;
  version_id: string;
  vo_seq: number;
  version_no: number;
  title: string;
  status: VariationStatus;
  photo_count: number;
  value_pence: number | null;
  created_at: string;
};

export type VariationList = {
  open_count: number;
  signed_count: number;
  rows: VariationSummary[];
};

export type VariationPhoto = {
  id: string;
  storage_path: string;
  content_type: string;
  file_size_bytes: number;
  sort_order: number;
  signed_url?: string | null;
  signed_url_expires_at?: string | null;
};

export type VariationSignature = {
  signer_name: string;
  signer_role: string;
  signer_company: string;
  confirmation_text: string;
  signature_png: string;
  signed_at: string;
};

export type VariationVersion = {
  version_id: string;
  version_no: number;
  title: string;
  description: string;
  level_area: string | null;
  quantity_text: string | null;
  value_pence: number | null;
  status: VariationStatus;
  is_current: boolean;
  created_at: string;
  locked_at: string | null;
  photo_count: number;
  photos: VariationPhoto[];
  signature: VariationSignature | null;
};

export type VariationDetail = {
  variation_id: string;
  site_id: string;
  vo_seq: number;
  current: VariationVersion;
  history: VariationVersion[];
};

export type VariationPhotoInput = {
  storagePath: string;
  contentType: string;
  fileSizeBytes: number;
};

export type CreateVariationInput = {
  siteId: string;
  title: string;
  description: string;
  levelArea?: string | null;
  quantityText?: string | null;
  valuePence?: number | null;
  photos: VariationPhotoInput[];
};

export function variationNumber(voSeq: number): string {
  return `VO-${voSeq}`;
}

export function variationPdfFilename(voSeq: number): string {
  return `Variation VO-${voSeq}.pdf`;
}

export function canSetVariationValue(role: Role): boolean {
  return role === 'owner' || role === 'cm';
}

export function formatPounds(pence: number): string {
  const negative = pence < 0;
  const abs = Math.abs(pence);
  const pounds = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}£${pounds.toLocaleString('en-GB')}.${rest} + VAT`;
}

/** The £ field stays off the screen while the phone is handed over. */
export function variationAmountEditorOpen(locked: boolean, manager: boolean, handover: boolean): boolean {
  return manager && !locked && !handover;
}

export function parsePounds(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, '').replace(/^£/, '');
  if (!trimmed) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) throw new Error('invalid_input');
  const [whole, frac = ''] = trimmed.split('.');
  const pence = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(pence) || pence > 100000000) throw new Error('invalid_input');
  return pence;
}

export function variationCounts(rows: Array<{ status: VariationStatus }>): { open: number; signed: number } {
  return {
    open: rows.filter((row) => row.status === 'Draft').length,
    signed: rows.filter((row) => row.status === 'Signed' || row.status === 'Sent').length,
  };
}

export function filterVariations(rows: VariationSummary[], filter: VariationFilter): VariationSummary[] {
  if (filter === 'All') return rows;
  return rows.filter((row) => row.status === filter);
}

export function variationError(code: string): string {
  switch (code) {
    case 'value_not_allowed':
      return 'Only the owner or contracts manager can set the amount.';
    case 'variation_locked':
      return 'This variation is locked. An edit starts a new version.';
    case 'photo_count':
      return 'Add between 1 and 10 photos.';
    case 'photo_too_large':
      return 'Each photo must be 1.5MB or smaller.';
    case 'invalid_path':
      return 'That photo could not be stored on this site.';
    case 'not_authorized':
      return 'You cannot open this variation.';
    case 'invalid_input':
      return 'Check the variation and try again.';
    default:
      return code === 'unknown' ? 'Could not save the variation.' : code;
  }
}

export function isVariationLocked(status: VariationStatus): boolean {
  return status === 'Signed' || status === 'Sent';
}
