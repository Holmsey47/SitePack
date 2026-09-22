import type { Drawing } from '@/data/types';

/** One-level names offered on upload. A typed name is stored as typed. */
export const FOLDER_PRESETS = [
  'Ground floor',
  'First floor',
  'Second floor',
  'Elevations',
  'Sections',
  'Other',
] as const;

export const OTHER_FOLDER = 'Other';

export function displayFolder(folder: string | null | undefined): string {
  const trimmed = folder?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : OTHER_FOLDER;
}

/**
 * Folder stored on a new or replaced sheet.
 * Null means "not sent": copy the previous current row, or Other when there is none.
 * A blank string is Other. Folder is not part of sheet identity.
 */
export function resolveFolder(
  folder: string | null | undefined,
  previousFolder?: string | null
): string {
  if (folder == null) return displayFolder(previousFolder);
  return displayFolder(folder);
}

function folderSortKey(name: string): string {
  if (name === OTHER_FOLDER) return `2:${name}`;
  const presetIndex = FOLDER_PRESETS.indexOf(name as (typeof FOLDER_PRESETS)[number]);
  if (presetIndex >= 0) return `0:${String(presetIndex).padStart(2, '0')}`;
  return `1:${name.toLocaleLowerCase()}`;
}

export function compareFolderNames(a: string, b: string): number {
  return folderSortKey(a).localeCompare(folderSortKey(b));
}

export type FolderSummary = {
  name: string;
  currentCount: number;
  supersededCount: number;
  /** True when every sheet in the folder is superseded. Still listed, still opens. */
  archive: boolean;
};

/** Every folder that has any sheet. Archive folders are not dropped. */
export function packFolders(drawings: Drawing[]): FolderSummary[] {
  const counts = new Map<string, { currentCount: number; supersededCount: number }>();
  for (const drawing of drawings) {
    const name = displayFolder(drawing.folder);
    const group = counts.get(name) ?? { currentCount: 0, supersededCount: 0 };
    if (drawing.is_current) group.currentCount += 1;
    else group.supersededCount += 1;
    counts.set(name, group);
  }
  return [...counts.entries()]
    .map(([name, group]) => ({
      name,
      currentCount: group.currentCount,
      supersededCount: group.supersededCount,
      archive: group.currentCount === 0,
    }))
    .sort((a, b) => compareFolderNames(a.name, b.name));
}

function bySheet(a: Drawing, b: Drawing): number {
  return a.title.localeCompare(b.title) || (a.sheet_number ?? '').localeCompare(b.sheet_number ?? '');
}

export function drawingsInFolder(
  drawings: Drawing[],
  folder: string
): { current: Drawing[]; superseded: Drawing[] } {
  const name = displayFolder(folder);
  const rows = drawings.filter((drawing) => displayFolder(drawing.folder) === name);
  return {
    current: rows.filter((drawing) => drawing.is_current).sort(bySheet),
    superseded: rows.filter((drawing) => !drawing.is_current).sort(bySheet),
  };
}
