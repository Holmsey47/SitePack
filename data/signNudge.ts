import { memberMustSign, siteDocumentKindLabel } from '@/data/siteDocuments';
import type { Role } from '@/data/types';

/** A current RAMS or induction this person still has to sign. */
export type UnsignedSignDocument = {
  id: string;
  siteId: string;
  siteName: string;
  kind: 'induction' | 'rams';
  title: string;
  versionId: string;
};

/** One row from the Home read, before the signing rules are applied. */
export type SignNudgeRow = {
  id: string;
  siteId: string;
  siteName: string;
  kind: string;
  title: string;
  archivedAt: string | null;
  assigned: boolean;
  versionId: string;
  current: boolean;
  signerIds: readonly string[];
};

/**
 * Documents this person must sign. Owners do not sign. A contracts manager
 * sees only their own unsigned current version, not anyone else's.
 * Archived, unassigned, toolbox, and already-signed rows are left out.
 */
export function unsignedSignDocuments(
  rows: readonly SignNudgeRow[],
  person: { id: string; role: Role | undefined },
): UnsignedSignDocument[] {
  if (!memberMustSign(person.role)) return [];
  const next: UnsignedSignDocument[] = [];
  for (const row of rows) {
    if (row.kind !== 'induction' && row.kind !== 'rams') continue;
    if (row.archivedAt != null) continue;
    if (!row.assigned) continue;
    if (!row.current) continue;
    if (!row.id || !row.siteId || !row.versionId) continue;
    if (!row.title.trim() || !row.siteName.trim()) continue;
    if (row.signerIds.includes(person.id)) continue;
    next.push({
      id: row.id,
      siteId: row.siteId,
      siteName: row.siteName,
      kind: row.kind,
      title: row.title.trim(),
      versionId: row.versionId,
    });
  }
  next.sort(
    (left, right) =>
      left.siteName.localeCompare(right.siteName, 'en') ||
      left.title.localeCompare(right.title, 'en') ||
      left.id.localeCompare(right.id),
  );
  return next;
}

/**
 * One row on Documents to sign. The title is the document name.
 * The subtitle is the kind and the site, so "Induction" is not repeated.
 */
export function signListRow(
  doc: Pick<UnsignedSignDocument, 'kind' | 'title' | 'siteName'>,
): { title: string; subtitle: string } {
  return {
    title: doc.title.trim(),
    subtitle: `${siteDocumentKindLabel(doc.kind)} · ${doc.siteName.trim()}`,
  };
}

/** Title line, then the site or the list hint. None is no card. */
export type SignNudgeCopy = { title: string; detail: string };

export function signNudgeCopy(
  docs: readonly Pick<UnsignedSignDocument, 'kind' | 'title' | 'siteName'>[],
): SignNudgeCopy | null {
  if (docs.length === 0) return null;
  if (docs.length === 1) {
    const doc = docs[0];
    return {
      title: `Sign ${siteDocumentKindLabel(doc.kind)}: ${doc.title}`,
      detail: doc.siteName,
    };
  }
  return { title: `${docs.length} documents to sign`, detail: 'Tap to see them' };
}

export type SignNudgeTarget =
  | { kind: 'document'; siteId: string; documentId: string }
  | { kind: 'list' };

/** One document opens that document. More than one opens the list. */
export function signNudgeTarget(docs: readonly Pick<UnsignedSignDocument, 'id' | 'siteId'>[]): SignNudgeTarget | null {
  if (docs.length === 0) return null;
  if (docs.length === 1) return { kind: 'document', siteId: docs[0].siteId, documentId: docs[0].id };
  return { kind: 'list' };
}

/** A failed read is null so the Home card stays hidden. */
export async function loadSignNudge(
  read: () => Promise<UnsignedSignDocument[]>,
): Promise<UnsignedSignDocument[] | null> {
  try {
    const rows = await read();
    if (!Array.isArray(rows)) return null;
    return rows;
  } catch {
    return null;
  }
}

export function signNudgeVisible(rows: UnsignedSignDocument[] | null): boolean {
  return rows != null && rows.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function many(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((row): row is Record<string, unknown> => row != null);
  const one = asRecord(value);
  return one ? [one] : [];
}

/**
 * Turns the single nested read into rows. A payload that is not a list throws,
 * which the Home card treats as a failed read.
 */
export function rowsFromSignNudgeRead(data: unknown, personId: string): SignNudgeRow[] {
  if (!Array.isArray(data)) throw new Error('Could not read documents to sign.');
  const rows: SignNudgeRow[] = [];
  for (const item of data) {
    const record = asRecord(item);
    if (!record) throw new Error('Could not read documents to sign.');
    const site = asRecord(Array.isArray(record.sites) ? record.sites[0] : record.sites);
    const versions = many(record.site_document_versions);
    const version = versions.find((row) => row.is_current === true) ?? null;
    if (!site || !version) continue;
    const assignments = many(site.site_assignments);
    const signatures = many(version.site_document_signatures);
    rows.push({
      id: typeof record.id === 'string' ? record.id : '',
      siteId: typeof record.site_id === 'string' ? record.site_id : '',
      siteName: typeof site.name === 'string' ? site.name : '',
      kind: typeof record.kind === 'string' ? record.kind : '',
      title: typeof record.title === 'string' ? record.title : '',
      archivedAt: record.archived_at == null ? null : String(record.archived_at),
      assigned: assignments.some((row) => row.person_id === personId),
      versionId: typeof version.id === 'string' ? version.id : '',
      current: version.is_current === true,
      signerIds: signatures
        .map((row) => (typeof row.person_id === 'string' ? row.person_id : ''))
        .filter((id) => id.length > 0),
    });
  }
  return rows;
}
