import type { Role } from '@/data/types';

export const PACK_DOWNLOAD_ERROR = 'Could not download the pack.';

/** Parent `sitepack` does not exist on a fresh phone. `create()` without these options is rejected. */
export const PACK_DIRECTORY_CREATE = { intermediates: true, idempotent: true } as const;

export function ensurePackDirectory(folder: { create: (options: typeof PACK_DIRECTORY_CREATE) => void }) {
  folder.create(PACK_DIRECTORY_CREATE);
}

export function roleLabel(role: Role): string {
  if (role === 'cm') return 'Contracts manager';
  if (role === 'owner') return 'Owner';
  return 'Operative';
}

/** Occupation is a label. A blank one stays the role. It does not change access. */
export function occupationLine(role: Role, trade: string | null | undefined): string {
  const title = trade?.trim();
  if (!title) return roleLabel(role);
  return `${roleLabel(role)} · ${title}`;
}

export function assignmentRank(role: Role | undefined): number {
  if (role === 'cm') return 0;
  if (role === 'operative') return 1;
  return 2;
}

/** Display name, then email when the caller is allowed to see it, otherwise Unknown. */
export function personLabel(
  person: { display_name?: string | null; email?: string | null } | null | undefined,
): string {
  const name = person?.display_name?.trim() ?? '';
  if (name) return name;
  const email = person?.email?.trim() ?? '';
  if (email) return email;
  return 'Unknown';
}

/** Email and phone the caller is allowed to see. Empty when both are blank. */
export function contactLine(
  person: { email?: string | null; phone?: string | null } | null | undefined,
): string {
  const email = person?.email?.trim() ?? '';
  const phone = person?.phone?.trim() ?? '';
  return [email, phone].filter((part) => part.length > 0).join(' · ');
}

/** Pulse and other shared name lists. A blank name is Unknown, never an email. */
export function previewName(displayName: string | null | undefined): string {
  const name = displayName?.trim() ?? '';
  return name || 'Unknown';
}

export function siteLabel(names: string[]): string {
  if (names.length === 0) return 'Unassigned';
  return names.join(', ');
}

export function contractsManagerLine(names: string[]): string {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (clean.length === 0) return 'Contracts manager: none';
  return `Contracts manager: ${clean.join(', ')}`;
}

export function operativesLine(count: number): string {
  return `Operatives: ${count} assigned.`;
}

export function requestSentLine(names: string[]): string {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (clean.length === 0) return 'Request sent.';
  return `Request sent to ${clean.join(', ')}.`;
}

export function revisionCurrentLine(revision: string): string {
  return `Rev ${revision} is current.`;
}

export function workingRows<T extends { archived_at: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => !row.archived_at);
}

export function archivedRows<T extends { archived_at: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => Boolean(row.archived_at));
}

export function inviteSiteIds(input: { siteId?: string | null; siteIds?: string[] }): string[] {
  const ids = [...(input.siteIds ?? [])];
  if (input.siteId) ids.push(input.siteId);
  return [...new Set(ids.filter(Boolean))];
}
