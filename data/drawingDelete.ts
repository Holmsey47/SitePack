/** One drawings row. Revisions are rows linked by supersedes_id, not a versions table. */
export type RevisionRow = {
  id: string;
  siteId: string;
  title: string;
  sheetKey: string;
  supersedesId: string | null;
};

/** Sheet identity matches the generated drawings.sheet_key column. */
export function sheetKeyOf(sheetNumber: string | null | undefined): string {
  return (sheetNumber ?? '').trim();
}

/**
 * Every revision of the sheet: walk supersedes_id both ways, and include any
 * row with the same site, title, and sheet key as a row already in the family.
 * Deleting either the current row or an older one removes the whole set.
 */
export function revisionFamilyIds(anchorId: string, rows: RevisionRow[]): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (!byId.has(anchorId)) return [];
  const ids = new Set<string>([anchorId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (ids.has(row.id)) continue;
      const pointsAtFamily = row.supersedesId != null && ids.has(row.supersedesId);
      const familyPointsHere = [...ids].some((id) => byId.get(id)?.supersedesId === row.id);
      const sameSheet = [...ids].some((id) => {
        const known = byId.get(id);
        return (
          known != null &&
          known.siteId === row.siteId &&
          known.title === row.title &&
          known.sheetKey === row.sheetKey
        );
      });
      if (pointsAtFamily || familyPointsHere || sameSheet) {
        ids.add(row.id);
        grew = true;
      }
    }
  }
  return [...ids];
}

/**
 * Storage remove is after the rows are gone. Clear orphan records only for
 * paths the bucket actually dropped. Anything left stays for a later sweep.
 */
export function pathsToClear(
  expected: string[],
  removed: string[] | null | undefined,
  failed: boolean,
): { clear: string[]; pending: string[] } {
  const gone = new Set((removed ?? []).filter((path) => path.length > 0));
  if (failed && gone.size === 0) return { clear: [], pending: [...expected] };
  return {
    clear: expected.filter((path) => gone.has(path)),
    pending: expected.filter((path) => !gone.has(path)),
  };
}
