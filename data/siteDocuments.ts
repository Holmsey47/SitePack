import type { Role } from '@/data/types';

export const SITE_DOCUMENT_KINDS = [
  { kind: 'induction', label: 'Induction' },
  { kind: 'toolbox', label: 'Toolbox talk' },
  { kind: 'rams', label: 'RAMS' },
] as const;

export type SiteDocumentKind = (typeof SITE_DOCUMENT_KINDS)[number]['kind'];

export function isSiteDocumentKind(kind: string): kind is SiteDocumentKind {
  return SITE_DOCUMENT_KINDS.some((item) => item.kind === kind);
}

export function siteDocumentKindLabel(kind: string): string {
  return SITE_DOCUMENT_KINDS.find((item) => item.kind === kind)?.label ?? 'Document';
}

/** What the person is agreeing to. Sentence case, one line per kind. */
export function siteDocumentSignLabel(kind: string): string {
  if (kind === 'toolbox') return "I've read the toolbox talk and understand it";
  if (kind === 'rams') return "I've read the RAMS and understand it";
  if (kind === 'induction') return "I've read the site induction and understand it";
  return "I've read this and understand it";
}

const archivedNow = new Set<string>();

/** Remember an archive before the list refetches, so the first paint is not "Version 2". */
export function rememberArchivedDocument(id: string): void {
  archivedNow.add(id);
}

export function documentIsArchived(row: { id: string; archived_at: string | null }): boolean {
  return row.archived_at != null || archivedNow.has(row.id);
}

/** Archived wins over the version line. A live owner row still names the version. */
export function siteDocumentStatusLine(row: {
  id: string;
  archived_at: string | null;
  version_no: number;
  owner: boolean;
  signed: boolean;
}): string {
  if (documentIsArchived(row)) return 'Archived';
  if (row.owner) return `Version ${row.version_no}`;
  return row.signed ? 'Signed' : 'To sign';
}

function rowIsArchived(row: { id?: string; archived_at: string | null }): boolean {
  if (row.archived_at != null) return true;
  return row.id != null && archivedNow.has(row.id);
}

/** Live documents first, archived at the bottom, then title. */
export function orderedSiteDocuments<T extends { title: string; archived_at: string | null; id?: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((left, right) => {
    const archived = Number(rowIsArchived(left)) - Number(rowIsArchived(right));
    if (archived !== 0) return archived;
    return left.title.localeCompare(right.title, 'en');
  });
}

/** Assigned contracts managers and operatives sign. The owner reads the roster. */
export function memberMustSign(role: Role | undefined): boolean {
  return role === 'operative' || role === 'cm';
}

export const SITE_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

export function siteDocumentPickError(file: {
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
}): string | null {
  const name = file.name?.trim().toLowerCase() ?? '';
  const mime = file.mimeType?.trim().toLowerCase() ?? '';
  if ((mime && mime !== 'application/pdf') || (name && !name.endsWith('.pdf'))) return 'Choose a PDF.';
  if (file.size != null && file.size > SITE_DOCUMENT_MAX_BYTES) return 'That PDF is larger than 20MB.';
  return null;
}

export function siteDocumentBytesError(bytes: Uint8Array): string | null {
  if (bytes.byteLength > SITE_DOCUMENT_MAX_BYTES) return 'That PDF is larger than 20MB.';
  const header = PDF_MAGIC.every((byte, index) => bytes[index] === byte);
  if (!header) return 'Choose a PDF.';
  return null;
}

export function siteDocumentPath(
  companyId: string,
  siteId: string,
  documentId: string,
  versionId: string,
): string {
  return `${companyId}/${siteId}/${documentId}/${versionId}.pdf`;
}

export type SiteDocumentSummary = {
  id: string;
  site_id: string;
  kind: SiteDocumentKind;
  title: string;
  version_id: string;
  version_no: number;
  storage_path: string;
  signed_by_me: boolean;
  archived_at: string | null;
};

export type SiteDocumentSignature = {
  person_id: string;
  signed_at: string;
};

export type SiteDocumentDetail = SiteDocumentSummary & {
  signatures: SiteDocumentSignature[];
};

export type CreateSiteDocumentInput = {
  siteId: string;
  companyId: string;
  createdBy: string;
  title: string;
  kind: SiteDocumentKind;
  fileName: string;
  bytes: Uint8Array;
};

export type ReplaceSiteDocumentInput = {
  documentId: string;
  createdBy: string;
  fileName: string;
  bytes: Uint8Array;
};

export type SignSiteDocumentInput = {
  documentId: string;
  versionId: string;
  siteId: string;
  personId: string;
  signerName: string;
};

type AssignedSigner = {
  person_id: string;
  person?: { role?: Role; display_name?: string | null } | null;
};

/** Assigned people who must sign this version, unsigned names first. */
export function signRoster(
  assigned: readonly AssignedSigner[],
  signatures: readonly { person_id: string; signed_at: string }[],
): { person_id: string; name: string; signed_at: string | null }[] {
  const signedAt = new Map(signatures.map((row) => [row.person_id, row.signed_at]));
  const rows: { person_id: string; name: string; signed_at: string | null }[] = [];
  for (const row of assigned) {
    if (!memberMustSign(row.person?.role)) continue;
    const name = row.person?.display_name?.trim() || 'Unknown';
    rows.push({
      person_id: row.person_id,
      name,
      signed_at: signedAt.get(row.person_id) ?? null,
    });
  }
  rows.sort((left, right) => {
    if ((left.signed_at == null) !== (right.signed_at == null)) return left.signed_at == null ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  return rows;
}
