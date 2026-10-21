import type { Drawing } from '@/data/types';

/** Type names offered on upload. A typed name is stored as typed. */
export const FOLDER_PRESETS = [
  'Set out plans',
  'Ceilings',
  'Partitions',
  'M&E',
  'Elevations',
  'Sections',
  'Other',
] as const;

/** Optional level chips. A typed level is stored as typed. Blank stays blank. */
export const LEVEL_PRESETS = ['Basement', 'Ground', 'L1', 'L2', 'L3', 'L4', 'Roof'] as const;

export const OTHER_FOLDER = 'Other';

/** Stored folder and level tags. Matches drawings_folder_len and drawings_level_len. */
export const LABEL_LIMIT = 40;

/** Keep at most 40 characters. Trimming still happens when the sheet is saved. */
export function limitLabel(value: string): string {
  const chars = Array.from(value);
  if (chars.length <= LABEL_LIMIT) return value;
  return chars.slice(0, LABEL_LIMIT).join('');
}

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

/** Blank is null. A typed level is trimmed. */
export function displayLevel(level: string | null | undefined): string | null {
  const trimmed = level?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Level stored on a new or replaced sheet.
 * Null means "not sent": copy the previous current row, or null when there is none.
 * A blank string is null. Level is not part of sheet identity.
 */
export function resolveLevel(
  level: string | null | undefined,
  previousLevel?: string | null
): string | null {
  if (level == null) return displayLevel(previousLevel);
  return displayLevel(level);
}

function levelSortKey(name: string): string {
  const presetIndex = LEVEL_PRESETS.indexOf(name as (typeof LEVEL_PRESETS)[number]);
  if (presetIndex >= 0) return `0:${String(presetIndex).padStart(2, '0')}`;
  return `1:${name.toLocaleLowerCase()}`;
}

/**
 * Labels for the folder filter chips, without the All chip.
 * Only current sheets count. Blank is not a level.
 * Null means hide the row: the folder has 0 or 1 distinct levels.
 */
export function levelFilterLabels(sheets: Drawing[]): string[] | null {
  const seen = new Set<string>();
  for (const sheet of sheets) {
    if (!sheet.is_current) continue;
    const level = displayLevel(sheet.level);
    if (level) seen.add(level);
  }
  if (seen.size <= 1) return null;
  return [...seen].sort((a, b) => levelSortKey(a).localeCompare(levelSortKey(b)));
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
