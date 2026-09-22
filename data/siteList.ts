export function sitesAfterReload<T>(next: T[] | null, current: T[]): { sites: T[]; notice: string } {
  if (next == null) {
    return { sites: current, notice: 'The site list did not reload.' };
  }
  return { sites: next, notice: '' };
}
