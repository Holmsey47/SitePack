import { cardCountLine } from '@/data/drawingSeen';

/** Home shows 999+ past this. The site bar uses a smaller cap. */
export const HOME_COUNT_CAP = 999;

export type HomeKindCounts = {
  snags: number;
  variations: number;
  requests: number;
};

/**
 * Digits for one kind. Zero and anything that is not a positive count are hidden,
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

/** Null hides the new line. A site missing from a successful read is a true zero. */
export function countsForSite(
  read: Readonly<Record<string, HomeKindCounts>> | null,
  siteId: string,
): HomeKindCounts | null {
  if (read == null) return null;
  return read[siteId] ?? { snags: 0, variations: 0, requests: 0 };
}

function kindPhrase(count: number, singular: string, plural: string): string | null {
  const text = formatHomeCount(count);
  if (text == null) return null;
  return text === '1' ? `1 ${singular}` : `${text} ${plural}`;
}

/**
 * One bold sentence for the kinds above zero. A failed read and an all-zero
 * read both return null, so the card does not print "New:" or "0".
 */
export function homeNewCountLine(counts: HomeKindCounts | null): string | null {
  if (counts == null) return null;
  const parts = [
    kindPhrase(counts.snags, 'snag', 'snags'),
    kindPhrase(counts.variations, 'variation', 'variations'),
    kindPhrase(counts.requests, 'request', 'requests'),
  ].filter((part): part is string => part != null);
  if (parts.length === 0) return null;
  return `New: ${parts.join(' · ')}`;
}

/**
 * The count phrase stays in one piece, and "New:" stays with the first count,
 * so a narrow card wraps on the dot and not in the middle of "1 snag".
 */
export function glueNewLine(line: string): string {
  return line.replace(/(\d+\+?) /g, '$1\u00a0').replace(/^New: /, 'New:\u00a0');
}

/** Pieces of the New line. Each piece keeps its number with its word. */
export function freshLineParts(line: string): string[] {
  return glueNewLine(line)
    .split(' · ')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Open requests, worded so they are not a second bare "N request" next to New. */
function openRequestsLine(requests: number, unseen: number): string | null {
  const parts: string[] = [];
  if (requests === 1) parts.push('1 open request');
  else if (requests > 1) parts.push(`${requests} open requests`);
  if (unseen === 1) parts.push('1 unseen');
  else if (unseen > 1) parts.push(`${unseen} unseen`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export type HomeCardLines = {
  /** Open requests and unseen drawings. Main's wording unless New also names requests. */
  status: string | null;
  /** The new-counts sentence. Null when the read failed or every kind is zero. */
  fresh: string | null;
};

/**
 * Failed read: status is exactly the line main shows today, and fresh is hidden.
 * Successful read that includes new requests: the open count is labelled "open"
 * so the card does not show two request numbers.
 */
export function homeCardLines(
  openRequests: number,
  unseenDrawings: number,
  counts: HomeKindCounts | null,
): HomeCardLines {
  const fresh = homeNewCountLine(counts);
  if (counts == null) {
    return { status: cardCountLine(openRequests, unseenDrawings), fresh: null };
  }
  const status =
    fresh != null && fresh.includes('request')
      ? openRequestsLine(openRequests, unseenDrawings)
      : cardCountLine(openRequests, unseenDrawings);
  return { status, fresh };
}
