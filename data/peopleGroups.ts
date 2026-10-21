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

export function groupCount(data: unknown, key: 'added' | 'removed'): number {
  if (!data || typeof data !== 'object' || !(key in data)) return 0;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : 0;
}
