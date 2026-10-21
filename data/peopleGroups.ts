import type { Role } from '@/data/types';

export function canEditPeopleGroup(role: Role): boolean {
  return role === 'owner';
}

export function canAssignPeopleGroup(role: Role): boolean {
  return role === 'owner' || role === 'cm';
}

/** Trimmed name, 1 to 40 characters. Same rule as people_groups_name_len. */
export function normalizeGroupName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('name_required');
  if (Array.from(trimmed).length > 40) throw new Error('name_too_long');
  return trimmed;
}

export function groupFailureMessage(message: string): string {
  switch (message.trim()) {
    case 'name_required':
      return 'Enter a group name.';
    case 'name_too_long':
      return 'Use 40 characters or fewer.';
    case 'name_in_use':
      return 'That group name is already used.';
    case 'person_not_in_company':
      return 'Choose people from this company.';
    case 'site_not_found':
      return 'That site is not in the company.';
    case 'site_required':
      return 'Choose at least one site.';
    case 'not_authorized':
      return 'You can’t do that.';
    default:
      return 'Could not update the group.';
  }
}

export function memberRowMark(inGroup: boolean): 'In group' | 'Not in group' {
  return inGroup ? 'In group' : 'Not in group';
}

export function siteRowMark(selected: boolean): 'Selected' | 'Not selected' {
  return selected ? 'Selected' : 'Not selected';
}

/** True when the draft membership is the saved set, ignoring order. */
export function sameMemberIds(saved: readonly string[], draft: readonly string[]): boolean {
  if (saved.length !== draft.length) return false;
  const left = [...saved].sort();
  const right = [...draft].sort();
  return left.every((id, index) => id === right[index]);
}

/**
 * How many edits are waiting. A renamed name is one change. Each person added
 * or taken out of the saved member list is one change. Order does not count.
 */
export function groupChangeCount(input: {
  savedName: string;
  draftName: string;
  savedMemberIds: readonly string[];
  draftMemberIds: readonly string[];
}): number {
  const nameChanged = input.savedName.trim() !== input.draftName.trim() ? 1 : 0;
  const saved = new Set(input.savedMemberIds);
  const draft = new Set(input.draftMemberIds);
  let members = 0;
  for (const id of saved) if (!draft.has(id)) members += 1;
  for (const id of draft) if (!saved.has(id)) members += 1;
  return nameChanged + members;
}

export function saveChangesLabel(count: number): string {
  return `Save changes (${count})`;
}

export function groupCount(data: unknown, key: 'added' | 'removed'): number {
  if (!data || typeof data !== 'object' || !(key in data)) return 0;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : 0;
}
