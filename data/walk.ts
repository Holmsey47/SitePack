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
