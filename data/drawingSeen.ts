/** Current-revision seen proof. Superseded confirmations stay, and only people still assigned count. */

export type ProofOpen = {
  drawing_id: string;
  site_id: string;
  person_id: string;
  revision: string;
  opened_at: string;
};

export type ProofSeen = {
  drawing_id: string;
  site_id: string;
  person_id: string;
  revision: string;
  seen_at: string;
  received_at: string;
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Device tap time is kept when it is at or after the recorded open and at most
 * 5 minutes ahead of the server receive time. Otherwise the receive time is used.
 */
export function resolveSeenAt(
  tap: string | null | undefined,
  openedAt: string,
  receivedAt: string
): string {
  const tapMs = tap ? Date.parse(tap) : Number.NaN;
  const openMs = Date.parse(openedAt);
  const receivedMs = Date.parse(receivedAt);
  if (!Number.isFinite(tapMs) || !Number.isFinite(openMs) || !Number.isFinite(receivedMs)) return receivedAt;
  if (tapMs > receivedMs + FIVE_MINUTES_MS) return receivedAt;
  if (tapMs < openMs) return receivedAt;
  return tap as string;
}

export type UnseenDrawing = {
  site_id: string;
  site_name: string;
  drawing_id: string;
  title: string;
  sheet_number: string | null;
  sheet: string;
  revision: string;
};

export type DrawingProof = {
  drawing_id: string;
  site_id: string;
  revision: string;
  is_current: boolean;
  assigned: boolean;
  opened: boolean;
  seen_at: string | null;
};

export type DrawingSeenCount = {
  drawing_id: string;
  title: string;
  sheet_number: string | null;
  revision: string;
  seen_count: number;
};

export type SiteSeenSummary = {
  site_id: string;
  assigned_count: number;
  not_seen_by_everyone: number;
  drawings: DrawingSeenCount[];
};

export type SeenRosterPerson = {
  person_id: string;
  display_name: string | null;
  seen_at: string;
};

export type UnseenRosterPerson = {
  person_id: string;
  display_name: string | null;
};

export type DrawingRoster = {
  drawing_id: string;
  site_id: string;
  title: string;
  sheet_number: string | null;
  revision: string;
  is_current: boolean;
  seen_count: number;
  assigned_count: number;
  seen: SeenRosterPerson[];
  unseen: UnseenRosterPerson[];
};

export type SiteSeenGap = {
  site_id: string;
  not_seen_by_everyone: number;
};

export type SeenSheet = {
  id: string;
  site_id: string;
  title: string;
  sheet_number: string | null;
  revision: string;
  is_current: boolean;
};

export type SeenAssignment = {
  site_id: string;
  person_id: string;
};

export type SeenName = {
  id: string;
  display_name: string | null;
};

export function sheetLabel(drawing: { sheet_number: string | null; title: string }): string {
  const sheet = drawing.sheet_number?.trim();
  return sheet ? sheet : drawing.title;
}

export function newRevLabel(sheet: string, revision: string): string {
  return `New: ${sheet} rev ${revision}`;
}

export function seenCountLabel(seen: number, total: number): string {
  return `${seen} of ${total} seen`;
}

export function seenButtonLabel(revision: string): string {
  return `I've seen rev ${revision}`;
}

/** Site-level line. Zero means everyone assigned has seen every current sheet. */
export function siteUnseenLine(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return '1 drawing not seen by everyone';
  return `${count} drawings not seen by everyone`;
}

export function personLabel(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'No name';
}

export function assignedPersonIds(assignments: SeenAssignment[], siteId: string): string[] {
  return [...new Set(assignments.filter((row) => row.site_id === siteId).map((row) => row.person_id))];
}

export function countSeen(
  seen: ProofSeen[],
  drawingId: string,
  revision: string,
  personIds: string[]
): number {
  const allowed = new Set(personIds);
  const who = new Set(
    seen
      .filter((row) => row.drawing_id === drawingId && row.revision === revision && allowed.has(row.person_id))
      .map((row) => row.person_id)
  );
  return who.size;
}

export function recordOpen(opens: ProofOpen[], row: Omit<ProofOpen, 'opened_at'> & { opened_at?: string }): ProofOpen {
  const existing = opens.find(
    (item) => item.drawing_id === row.drawing_id && item.person_id === row.person_id && item.revision === row.revision
  );
  if (existing) return existing;
  const created: ProofOpen = {
    drawing_id: row.drawing_id,
    site_id: row.site_id,
    person_id: row.person_id,
    revision: row.revision,
    opened_at: row.opened_at ?? new Date().toISOString(),
  };
  opens.push(created);
  return created;
}

/** First confirmation time sticks. A tap with no open throws not_opened. */
export function confirmSeen(
  opens: ProofOpen[],
  seen: ProofSeen[],
  row: Omit<ProofSeen, 'seen_at' | 'received_at'> & { seen_at?: string | null; received_at?: string }
): ProofSeen {
  const opened = opens.find(
    (item) => item.drawing_id === row.drawing_id && item.person_id === row.person_id && item.revision === row.revision
  );
  if (!opened) throw new Error('not_opened');
  const existing = seen.find(
    (item) => item.drawing_id === row.drawing_id && item.person_id === row.person_id && item.revision === row.revision
  );
  if (existing) return existing;
  const receivedAt = row.received_at ?? new Date().toISOString();
  const created: ProofSeen = {
    drawing_id: row.drawing_id,
    site_id: row.site_id,
    person_id: row.person_id,
    revision: row.revision,
    seen_at: resolveSeenAt(row.seen_at, opened.opened_at, receivedAt),
    received_at: receivedAt,
  };
  seen.push(created);
  return created;
}

export function buildSiteSummary(
  siteId: string,
  drawings: SeenSheet[],
  assignments: SeenAssignment[],
  seen: ProofSeen[]
): SiteSeenSummary {
  const people = assignedPersonIds(assignments, siteId);
  const current = drawings
    .filter((drawing) => drawing.site_id === siteId && drawing.is_current)
    .map((drawing) => ({
      drawing_id: drawing.id,
      title: drawing.title,
      sheet_number: drawing.sheet_number,
      revision: drawing.revision,
      seen_count: countSeen(seen, drawing.id, drawing.revision, people),
    }))
    .sort((a, b) => a.title.localeCompare(b.title) || (a.sheet_number ?? '').localeCompare(b.sheet_number ?? ''));
  const notSeen =
    people.length === 0 ? 0 : current.filter((drawing) => drawing.seen_count < people.length).length;
  return {
    site_id: siteId,
    assigned_count: people.length,
    not_seen_by_everyone: notSeen,
    drawings: current,
  };
}

export function buildRoster(
  drawing: SeenSheet,
  assignments: SeenAssignment[],
  names: SeenName[],
  seen: ProofSeen[]
): DrawingRoster {
  const people = assignedPersonIds(assignments, drawing.site_id);
  const nameOf = new Map(names.map((person) => [person.id, person.display_name]));
  const seenRows = seen
    .filter((row) => row.drawing_id === drawing.id && row.revision === drawing.revision && people.includes(row.person_id))
    .sort((a, b) => a.seen_at.localeCompare(b.seen_at));
  const seenIds = new Set(seenRows.map((row) => row.person_id));
  return {
    drawing_id: drawing.id,
    site_id: drawing.site_id,
    title: drawing.title,
    sheet_number: drawing.sheet_number,
    revision: drawing.revision,
    is_current: drawing.is_current,
    seen_count: seenIds.size,
    assigned_count: people.length,
    seen: seenRows.map((row) => ({
      person_id: row.person_id,
      display_name: nameOf.get(row.person_id) ?? null,
      seen_at: row.seen_at,
    })),
    unseen: people
      .filter((personId) => !seenIds.has(personId))
      .map((personId) => ({ person_id: personId, display_name: nameOf.get(personId) ?? null }))
      .sort((a, b) => personLabel(a.display_name).localeCompare(personLabel(b.display_name))),
  };
}

export function unseenForPerson(
  personId: string,
  drawings: SeenSheet[],
  assignments: SeenAssignment[],
  seen: ProofSeen[],
  siteNames: Map<string, string>
): UnseenDrawing[] {
  const sites = new Set(assignments.filter((row) => row.person_id === personId).map((row) => row.site_id));
  return drawings
    .filter((drawing) => drawing.is_current && sites.has(drawing.site_id))
    .filter(
      (drawing) =>
        !seen.some(
          (row) => row.drawing_id === drawing.id && row.person_id === personId && row.revision === drawing.revision
        )
    )
    .map((drawing) => ({
      site_id: drawing.site_id,
      site_name: siteNames.get(drawing.site_id) ?? '',
      drawing_id: drawing.id,
      title: drawing.title,
      sheet_number: drawing.sheet_number,
      sheet: sheetLabel(drawing),
      revision: drawing.revision,
    }))
    .sort((a, b) => a.site_name.localeCompare(b.site_name) || a.sheet.localeCompare(b.sheet));
}

export function managerGaps(
  drawings: SeenSheet[],
  assignments: SeenAssignment[],
  seen: ProofSeen[],
  accessibleSiteIds: string[]
): SiteSeenGap[] {
  return accessibleSiteIds
    .map((siteId) => buildSiteSummary(siteId, drawings, assignments, seen))
    .filter((summary) => summary.not_seen_by_everyone > 0)
    .map((summary) => ({ site_id: summary.site_id, not_seen_by_everyone: summary.not_seen_by_everyone }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function parseUnseenDrawings(data: unknown): UnseenDrawing[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const item = asRecord(row);
    const drawingId = asString(item?.drawing_id);
    const revision = asString(item?.revision);
    if (!item || !drawingId || !revision) return [];
    return [
      {
        site_id: asString(item.site_id) ?? '',
        site_name: asString(item.site_name) ?? '',
        drawing_id: drawingId,
        title: asString(item.title) ?? '',
        sheet_number: asString(item.sheet_number),
        sheet: asString(item.sheet) ?? asString(item.title) ?? '',
        revision,
      },
    ];
  });
}

export function parseDrawingProof(data: unknown): DrawingProof {
  const item = asRecord(data);
  if (!item || !asString(item.drawing_id) || !asString(item.revision)) throw new Error('invalid_input');
  return {
    drawing_id: asString(item.drawing_id) ?? '',
    site_id: asString(item.site_id) ?? '',
    revision: asString(item.revision) ?? '',
    is_current: item.is_current === true,
    assigned: item.assigned === true,
    opened: item.opened === true,
    seen_at: asString(item.seen_at),
  };
}

export function parseSiteSeenSummary(data: unknown): SiteSeenSummary {
  const item = asRecord(data);
  if (!item) throw new Error('invalid_input');
  const drawings = Array.isArray(item.drawings) ? item.drawings : [];
  return {
    site_id: asString(item.site_id) ?? '',
    assigned_count: typeof item.assigned_count === 'number' ? item.assigned_count : 0,
    not_seen_by_everyone: typeof item.not_seen_by_everyone === 'number' ? item.not_seen_by_everyone : 0,
    drawings: drawings.flatMap((row) => {
      const drawing = asRecord(row);
      if (!drawing || !asString(drawing.drawing_id)) return [];
      return [
        {
          drawing_id: asString(drawing.drawing_id) ?? '',
          title: asString(drawing.title) ?? '',
          sheet_number: asString(drawing.sheet_number),
          revision: asString(drawing.revision) ?? '',
          seen_count: typeof drawing.seen_count === 'number' ? drawing.seen_count : 0,
        },
      ];
    }),
  };
}

export function parseDrawingRoster(data: unknown): DrawingRoster {
  const item = asRecord(data);
  if (!item || !asString(item.drawing_id)) throw new Error('invalid_input');
  const seen = Array.isArray(item.seen) ? item.seen : [];
  const unseen = Array.isArray(item.unseen) ? item.unseen : [];
  return {
    drawing_id: asString(item.drawing_id) ?? '',
    site_id: asString(item.site_id) ?? '',
    title: asString(item.title) ?? '',
    sheet_number: asString(item.sheet_number),
    revision: asString(item.revision) ?? '',
    is_current: item.is_current === true,
    seen_count: typeof item.seen_count === 'number' ? item.seen_count : 0,
    assigned_count: typeof item.assigned_count === 'number' ? item.assigned_count : 0,
    seen: seen.flatMap((row) => {
      const person = asRecord(row);
      if (!person || !asString(person.person_id) || !asString(person.seen_at)) return [];
      return [
        {
          person_id: asString(person.person_id) ?? '',
          display_name: asString(person.display_name),
          seen_at: asString(person.seen_at) ?? '',
        },
      ];
    }),
    unseen: unseen.flatMap((row) => {
      const person = asRecord(row);
      if (!person || !asString(person.person_id)) return [];
      return [{ person_id: asString(person.person_id) ?? '', display_name: asString(person.display_name) }];
    }),
  };
}

export function parseSiteSeenGaps(data: unknown): SiteSeenGap[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const item = asRecord(row);
    if (!item || !asString(item.site_id)) return [];
    return [
      {
        site_id: asString(item.site_id) ?? '',
        not_seen_by_everyone: typeof item.not_seen_by_everyone === 'number' ? item.not_seen_by_everyone : 0,
      },
    ];
  });
}

export function parseSeenAt(data: unknown): string {
  const item = asRecord(data);
  const seenAt = asString(item?.seen_at);
  if (!seenAt) throw new Error('invalid_input');
  return seenAt;
}
