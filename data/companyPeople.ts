import type { CompanyPerson, Role } from '@/data/types';

export function roleLabel(role: Role): string {
  if (role === 'cm') return 'contracts manager';
  return role;
}

export function loginLabel(hasLogin: boolean): string {
  return hasLogin ? 'Has a login' : 'No login';
}

export function siteLabel(names: string[]): string {
  if (names.length === 0) return 'On no site';
  return names.join(', ');
}

export function canAddNoLogin(callerRole: Role, name: string, siteIds: string[]): boolean {
  if (callerRole !== 'owner' && callerRole !== 'cm') return false;
  if (!name.trim()) return false;
  if (callerRole === 'cm' && siteIds.length === 0) return false;
  return true;
}

export function canAttachLogin(
  callerRole: Role,
  row: Pick<CompanyPerson, 'role' | 'has_login' | 'site_names'>,
  callerSites: { name: string }[]
): boolean {
  if (row.has_login || row.role !== 'operative') return false;
  if (callerRole === 'owner') return true;
  if (callerRole !== 'cm') return false;
  const names = new Set(row.site_names);
  return callerSites.some((site) => names.has(site.name));
}

export function removableSites<T extends { name: string }>(
  row: Pick<CompanyPerson, 'role' | 'site_names'>,
  callerSites: T[]
): T[] {
  if (row.role !== 'operative') return [];
  const names = new Set(row.site_names);
  return callerSites.filter((site) => names.has(site.name));
}

export function peopleFailureMessage(message: string): string {
  switch (message.trim()) {
    case 'name_required':
      return 'Enter a name.';
    case 'email_required':
      return 'Enter an email to attach the login.';
    case 'email_in_use':
      return 'That email is already used in this company.';
    case 'already_has_login':
      return 'This person already has a login.';
    case 'not_authorized':
      return 'You can’t do that.';
    case 'site_not_found':
      return 'That site is not in the company.';
    default:
      return message;
  }
}
