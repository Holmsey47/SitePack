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

/** Assigned contracts managers and operatives sign. The owner reads the roster. */
export function memberMustSign(role: Role | undefined): boolean {
  return role === 'operative' || role === 'cm';
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
