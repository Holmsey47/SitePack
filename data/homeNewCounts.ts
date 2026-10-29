import { SITE_BAR, type SiteListKind } from '@/data/siteListSeen';

/** Home shows 999+ past this. The site bar uses a smaller cap. */
export const HOME_COUNT_CAP = 999;

export type HomeKindCounts = {
  snags: number;
  variations: number;
  requests: number;
};

export type HomeCountPill = {
  kind: SiteListKind;
  icon: string;
  label: string;
  text: string;
};

/**
 * Digits for a pill. Zero and anything that is not a positive count are hidden,
 * so a failed read and a true zero look the same and neither prints "0".
 */
export function formatHomeCount(count: number): string | null {
  if (!Number.isFinite(count)) return null;
  const whole = Math.floor(count);
  if (whole < 1) return null;
  if (whole > HOME_COUNT_CAP) return `${HOME_COUNT_CAP}+`;
  return String(whole);
}

function asCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.floor(parsed);
  }
  return null;
}

/**
 * One RPC payload, keyed by site. A shape we do not recognise hides every
 * count instead of turning the gap into a zero.
 */
export function mapHomeNewCounts(rows: unknown): Record<string, HomeKindCounts> | null {
  if (!Array.isArray(rows)) return null;
  const mapped: Record<string, HomeKindCounts> = {};
  for (const row of rows) {
    if (row == null || typeof row !== 'object') return null;
    const record = row as Record<string, unknown>;
    const siteId = record.site_id;
    if (typeof siteId !== 'string' || siteId.length === 0) return null;
    const snags = asCount(record.snags_new);
    const variations = asCount(record.variations_new);
    const requests = asCount(record.requests_new);
    if (snags == null || variations == null || requests == null) return null;
    mapped[siteId] = { snags, variations, requests };
  }
  return mapped;
}

/** Null hides the pills. A site missing from a successful read is a true zero. */
export function countsForSite(
  read: Readonly<Record<string, HomeKindCounts>> | null,
  siteId: string,
): HomeKindCounts | null {
  if (read == null) return null;
  return read[siteId] ?? { snags: 0, variations: 0, requests: 0 };
}

/** Icon pills for counts above zero. A zero is omitted, not drawn in a neutral colour. */
export function homeCountPills(counts: HomeKindCounts | null): HomeCountPill[] {
  if (counts == null) return [];
  const pills: HomeCountPill[] = [];
  for (const item of SITE_BAR) {
    const text = formatHomeCount(counts[item.kind]);
    if (text == null) continue;
    pills.push({ kind: item.kind, icon: item.icon, label: item.label, text });
  }
  return pills;
}
