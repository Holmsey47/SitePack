import { IDS, SEED_PASSWORD } from '@/data/ids';
import type { SitePackRepo, SignInResult } from '@/data/repo';
import type {
  CreateRequestInput,
  Drawing,
  DrawingRequest,
  HomeSite,
  InviteInput,
  ManifestItem,
  Person,
  PulseRow,
  ReplaceDrawingInput,
  RequestStatus,
  SiteAssignment,
  Site,
} from '@/data/types';
import { pdfObjectUrl } from '@/lib/pdf';

type Store = {
  people: Person[];
  sites: Site[];
  assignments: SiteAssignment[];
  drawings: Drawing[];
  requests: DrawingRequest[];
  sessionPersonId: string | null;
};

const now = () => new Date().toISOString();

function seed(): Store {
  const people: Person[] = [
    {
      id: IDS.owner,
      company_id: IDS.company,
      role: 'owner',
      trade: null,
      display_name: 'Jordan Hale',
      email: 'owner@sitepack.test',
      phone: null,
      created_at: '2026-08-01T09:00:00.000Z',
    },
    {
      id: IDS.cm,
      company_id: IDS.company,
      role: 'cm',
      trade: 'contracts',
      display_name: 'Priya Shah',
      email: 'cm@sitepack.test',
      phone: null,
      created_at: '2026-08-01T09:00:00.000Z',
    },
    {
      id: IDS.amy,
      company_id: IDS.company,
      role: 'operative',
      trade: 'dryliner',
      display_name: 'Amy Keane',
      email: 'amy@sitepack.test',
      phone: null,
      created_at: '2026-08-01T09:00:00.000Z',
    },
    {
      id: IDS.ben,
      company_id: IDS.company,
      role: 'operative',
      trade: 'labourer',
      display_name: 'Ben Torres',
      email: 'ben@sitepack.test',
      phone: null,
      created_at: '2026-08-01T09:00:00.000Z',
    },
  ];

  const sites: Site[] = [
    {
      id: IDS.oak,
      company_id: IDS.company,
      name: 'Plot 12 – Oak Estate',
      address_line: 'Oak Estate, Phase 2',
      created_at: '2026-09-06T09:00:00.000Z',
      updated_at: '2026-09-17T18:02:00.000Z',
    },
    {
      id: IDS.riverside,
      company_id: IDS.company,
      name: 'Plot 4 – Riverside',
      address_line: 'Riverside, Block B',
      created_at: '2026-08-29T09:00:00.000Z',
      updated_at: '2026-08-29T09:00:00.000Z',
    },
    {
      id: IDS.warehouse,
      company_id: IDS.company,
      name: 'Warehouse – North Yard',
      address_line: 'North Yard compound',
      created_at: '2026-09-10T09:00:00.000Z',
      updated_at: '2026-09-12T09:00:00.000Z',
    },
  ];

  const assignments: SiteAssignment[] = [
    { id: 'aaaaaaaa-0001-0000-0000-000000000001', site_id: IDS.oak, person_id: IDS.cm, created_at: now() },
    { id: 'aaaaaaaa-0001-0000-0000-000000000002', site_id: IDS.oak, person_id: IDS.amy, created_at: now() },
    { id: 'aaaaaaaa-0001-0000-0000-000000000003', site_id: IDS.oak, person_id: IDS.ben, created_at: now() },
    { id: 'aaaaaaaa-0002-0000-0000-000000000001', site_id: IDS.riverside, person_id: IDS.amy, created_at: now() },
    { id: 'aaaaaaaa-0003-0000-0000-000000000001', site_id: IDS.warehouse, person_id: IDS.cm, created_at: now() },
  ];

  const drawings: Drawing[] = [
    {
      id: IDS.gfRevB,
      site_id: IDS.oak,
      title: 'Ground Floor GA',
      sheet_number: 'A-101',
      revision: 'B',
      dated: '2026-08-02',
      is_current: false,
      supersedes_id: null,
      storage_path: `${IDS.company}/${IDS.oak}/${IDS.gfRevB}.pdf`,
      file_size_bytes: 4200,
      content_type: 'application/pdf',
      uploaded_by: IDS.cm,
      created_at: '2026-08-02T10:00:00.000Z',
      updated_at: '2026-09-10T14:20:00.000Z',
    },
    {
      id: IDS.gfRevC,
      site_id: IDS.oak,
      title: 'Ground Floor GA',
      sheet_number: 'A-101',
      revision: 'C',
      dated: '2026-09-10',
      is_current: true,
      supersedes_id: IDS.gfRevB,
      storage_path: `${IDS.company}/${IDS.oak}/${IDS.gfRevC}.pdf`,
      file_size_bytes: 4300,
      content_type: 'application/pdf',
      uploaded_by: IDS.cm,
      created_at: '2026-09-10T14:20:00.000Z',
      updated_at: '2026-09-10T14:20:00.000Z',
    },
    {
      id: IDS.ffRevA,
      site_id: IDS.oak,
      title: 'First Floor GA',
      sheet_number: 'A-102',
      revision: 'A',
      dated: '2026-09-04',
      is_current: true,
      supersedes_id: null,
      storage_path: `${IDS.company}/${IDS.oak}/${IDS.ffRevA}.pdf`,
      file_size_bytes: 4100,
      content_type: 'application/pdf',
      uploaded_by: IDS.cm,
      created_at: '2026-09-04T11:00:00.000Z',
      updated_at: '2026-09-04T11:00:00.000Z',
    },
    {
      id: IDS.yard,
      site_id: IDS.warehouse,
      title: 'Compound Layout',
      sheet_number: 'Y-01',
      revision: 'A',
      dated: '2026-09-12',
      is_current: true,
      supersedes_id: null,
      storage_path: `${IDS.company}/${IDS.warehouse}/${IDS.yard}.pdf`,
      file_size_bytes: 3900,
      content_type: 'application/pdf',
      uploaded_by: IDS.cm,
      created_at: '2026-09-12T09:00:00.000Z',
      updated_at: '2026-09-12T09:00:00.000Z',
    },
  ];

  const requests: DrawingRequest[] = [
    {
      id: IDS.openRequest,
      site_id: IDS.oak,
      requester_id: IDS.amy,
      body: 'Need the ceiling setting-out for plot 12 kitchen. WhatsApp PDF was unreadable.',
      sheet_hint: 'A-101 soffit',
      photo_path: null,
      status: 'Open',
      fulfilled_drawing_id: null,
      cm_note: null,
      created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    },
  ];

  return { people, sites, assignments, drawings, requests, sessionPersonId: null };
}

const SESSION_KEY = 'sitepack.fixture.session';

function loadSessionId(): string | null {
  try {
    return globalThis.localStorage?.getItem(SESSION_KEY) ?? null;
  } catch {
    return null;
  }
}

function saveSessionId(id: string | null) {
  try {
    if (!id) globalThis.localStorage?.removeItem(SESSION_KEY);
    else globalThis.localStorage?.setItem(SESSION_KEY, id);
  } catch {
    // ignore
  }
}

let store: Store = seed();
store.sessionPersonId = loadSessionId();

function meOrThrow(): Person {
  const person = store.people.find((p) => p.id === store.sessionPersonId);
  if (!person) throw new Error('not_authorized');
  return person;
}

function canAccessSite(person: Person, siteId: string): boolean {
  const site = store.sites.find((s) => s.id === siteId && s.company_id === person.company_id);
  if (!site) return false;
  if (person.role === 'owner') return true;
  return store.assignments.some((a) => a.site_id === siteId && a.person_id === person.id);
}

function assignedSiteIds(person: Person): string[] {
  if (person.role === 'owner') {
    return store.sites.filter((s) => s.company_id === person.company_id).map((s) => s.id);
  }
  return store.assignments.filter((a) => a.person_id === person.id).map((a) => a.site_id);
}

function withCounts(site: Site, person: Person): HomeSite {
  const open = store.requests.filter((r) => r.site_id === site.id && r.status === 'Open');
  return {
    ...site,
    open_request_count: person.role === 'operative' ? undefined : open.length,
    my_open_request_count: open.filter((r) => r.requester_id === person.id).length,
  };
}

function requestView(row: DrawingRequest): DrawingRequest {
  const site = store.sites.find((s) => s.id === row.site_id);
  const requester = store.people.find((p) => p.id === row.requester_id);
  return {
    ...row,
    site_name: site?.name,
    requester_name: requester?.display_name ?? requester?.email ?? 'Unknown',
  };
}

function sheetKey(sheetNumber: string | null | undefined): string {
  return (sheetNumber ?? '').trim();
}

export const fixtureRepo: SitePackRepo = {
  async signIn(email, password): Promise<SignInResult> {
    if (password !== SEED_PASSWORD) {
      throw new Error('Couldn’t sign in. Check email and password and try again.');
    }
    const person = store.people.find((p) => p.email?.toLowerCase() === email.trim().toLowerCase());
    if (!person) {
      throw new Error('Couldn’t sign in. Check email and password and try again.');
    }
    store.sessionPersonId = person.id;
    saveSessionId(person.id);
    return { person, needsPassword: false };
  },

  async signOut() {
    store.sessionPersonId = null;
    saveSessionId(null);
  },

  async restoreSession() {
    const id = loadSessionId();
    store.sessionPersonId = id;
    return store.people.find((p) => p.id === id) ?? null;
  },

  async setPassword() {
    return;
  },

  async me() {
    return store.people.find((p) => p.id === store.sessionPersonId) ?? null;
  },

  async listAssignedSites() {
    const person = meOrThrow();
    const ids = assignedSiteIds(person);
    // Owner home is pulse; assigned list is still assignment-gated.
    const siteIds =
      person.role === 'owner'
        ? store.assignments.filter((a) => a.person_id === person.id).map((a) => a.site_id)
        : ids;
    return store.sites
      .filter((s) => siteIds.includes(s.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => withCounts(s, person));
  },

  async getSite(siteId) {
    const person = meOrThrow();
    if (!canAccessSite(person, siteId)) return null;
    const site = store.sites.find((s) => s.id === siteId);
    return site ? withCounts(site, person) : null;
  },

  async listDrawings(siteId) {
    const person = meOrThrow();
    if (!canAccessSite(person, siteId)) throw new Error('not_authorized');
    return store.drawings
      .filter((d) => d.site_id === siteId)
      .sort((a, b) => a.title.localeCompare(b.title) || Number(b.is_current) - Number(a.is_current));
  },

  async getDrawing(drawingId) {
    const person = meOrThrow();
    const drawing = store.drawings.find((d) => d.id === drawingId);
    if (!drawing || !canAccessSite(person, drawing.site_id)) return null;
    return drawing;
  },

  async sitePackManifest(siteId) {
    const person = meOrThrow();
    if (!canAccessSite(person, siteId)) throw new Error('not_authorized');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return store.drawings
      .filter((d) => d.site_id === siteId && d.is_current)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((d) => {
        const item: ManifestItem = {
          drawing_id: d.id,
          title: d.title,
          sheet_number: d.sheet_number,
          revision: d.revision,
          dated: d.dated,
          file_size_bytes: d.file_size_bytes,
          content_type: d.content_type,
          storage_path: d.storage_path,
          signed_url: pdfObjectUrl(d.id, d.title, d.revision, d.dated ?? ''),
          signed_url_expires_at: expires,
        };
        return item;
      });
  },

  async createRequest(input: CreateRequestInput) {
    const person = meOrThrow();
    if (!canAccessSite(person, input.siteId)) throw new Error('not_authorized');
    const row: DrawingRequest = {
      id: crypto.randomUUID(),
      site_id: input.siteId,
      requester_id: person.id,
      body: input.body,
      sheet_hint: input.sheetHint ?? null,
      photo_path: input.photoPath ?? null,
      status: 'Open',
      fulfilled_drawing_id: null,
      cm_note: null,
      created_at: now(),
      updated_at: now(),
    };
    store.requests.unshift(row);
    return requestView(row);
  },

  async listMyRequests() {
    const person = meOrThrow();
    return store.requests
      .filter((r) => r.requester_id === person.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(requestView);
  },

  async listInboxRequests() {
    const person = meOrThrow();
    if (person.role === 'operative') throw new Error('not_authorized');
    const ids =
      person.role === 'owner'
        ? store.sites.filter((s) => s.company_id === person.company_id).map((s) => s.id)
        : assignedSiteIds(person);
    return store.requests
      .filter((r) => ids.includes(r.site_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(requestView);
  },

  async getRequest(requestId) {
    const person = meOrThrow();
    const row = store.requests.find((r) => r.id === requestId);
    if (!row) return null;
    if (row.requester_id !== person.id && !canAccessSite(person, row.site_id)) return null;
    if (person.role === 'operative' && row.requester_id !== person.id) return null;
    return requestView(row);
  },

  async updateRequest(requestId, patch: { status: RequestStatus; cm_note?: string | null; fulfilled_drawing_id?: string | null }) {
    const person = meOrThrow();
    if (person.role === 'operative') throw new Error('not_authorized');
    const row = store.requests.find((r) => r.id === requestId);
    if (!row || !canAccessSite(person, row.site_id)) throw new Error('not_authorized');
    row.status = patch.status;
    if (patch.cm_note !== undefined) row.cm_note = patch.cm_note;
    if (patch.fulfilled_drawing_id !== undefined) row.fulfilled_drawing_id = patch.fulfilled_drawing_id;
    row.updated_at = now();
    return requestView(row);
  },

  async companySitesPulse(): Promise<PulseRow[]> {
    const person = meOrThrow();
    if (person.role === 'operative') throw new Error('not_authorized');
    const sites =
      person.role === 'owner'
        ? store.sites.filter((s) => s.company_id === person.company_id)
        : store.sites.filter((s) => canAccessSite(person, s.id) && person.role !== 'owner');
    return sites
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => {
        const names = store.assignments
          .filter((a) => a.site_id === s.id)
          .map((a) => store.people.find((p) => p.id === a.person_id)?.display_name ?? 'Unknown')
          .sort();
        return {
          site_id: s.id,
          name: s.name,
          address_line: s.address_line,
          assignee_count: names.length,
          assignee_names_preview: names.slice(0, 3),
          last_pack_update: s.updated_at,
          open_request_count: store.requests.filter((r) => r.site_id === s.id && r.status === 'Open').length,
        };
      });
  },

  async listAssignments(siteId) {
    const person = meOrThrow();
    if (!canAccessSite(person, siteId)) throw new Error('not_authorized');
    return store.assignments
      .filter((a) => a.site_id === siteId)
      .map((a) => ({ ...a, person: store.people.find((p) => p.id === a.person_id) }));
  },

  async addAssignment(siteId, personId) {
    const person = meOrThrow();
    if (person.role === 'operative' || !canAccessSite(person, siteId)) throw new Error('not_authorized');
    if (store.assignments.some((a) => a.site_id === siteId && a.person_id === personId)) return;
    store.assignments.push({
      id: crypto.randomUUID(),
      site_id: siteId,
      person_id: personId,
      created_at: now(),
    });
  },

  async removeAssignment(assignmentId) {
    const person = meOrThrow();
    const row = store.assignments.find((a) => a.id === assignmentId);
    if (!row || person.role === 'operative' || !canAccessSite(person, row.site_id)) {
      throw new Error('not_authorized');
    }
    store.assignments = store.assignments.filter((a) => a.id !== assignmentId);
  },

  async listCompanyPeople() {
    const person = meOrThrow();
    return store.people.filter((p) => p.company_id === person.company_id);
  },

  async uploadDrawingFile({ companyId, siteId, drawingId, bytes, contentType }) {
    const person = meOrThrow();
    if (person.role === 'operative' || !canAccessSite(person, siteId)) throw new Error('not_authorized');
    const storagePath = `${companyId}/${siteId}/${drawingId}.pdf`;
    pdfObjectUrl(drawingId, 'Uploaded sheet', 'X', new Date().toISOString().slice(0, 10));
    return { storagePath, fileSizeBytes: bytes.byteLength || 1, contentType };
  },

  async replaceDrawing(input: ReplaceDrawingInput) {
    const person = meOrThrow();
    if (person.role === 'operative' || !canAccessSite(person, input.siteId)) {
      throw new Error('not_authorized');
    }
    const key = sheetKey(input.sheetNumber);
    let old: Drawing | undefined;
    if (input.replaceDrawingId) {
      old = store.drawings.find((d) => d.id === input.replaceDrawingId && d.site_id === input.siteId);
      if (!old?.is_current) throw new Error('replace_target_not_current');
    } else {
      old = store.drawings.find(
        (d) => d.site_id === input.siteId && d.title === input.title.trim() && sheetKey(d.sheet_number) === key && d.is_current
      );
    }
    if (old) old.is_current = false;
    const created: Drawing = {
      id: input.id ?? crypto.randomUUID(),
      site_id: input.siteId,
      title: input.title.trim(),
      sheet_number: input.sheetNumber?.trim() || null,
      revision: input.revision.trim(),
      dated: input.dated ?? null,
      is_current: true,
      supersedes_id: old?.id ?? null,
      storage_path: input.storagePath,
      file_size_bytes: input.fileSizeBytes ?? null,
      content_type: input.contentType ?? 'application/pdf',
      uploaded_by: person.id,
      created_at: now(),
      updated_at: now(),
    };
    store.drawings.push(created);
    const site = store.sites.find((s) => s.id === input.siteId);
    if (site) site.updated_at = now();
    return created;
  },

  async invitePerson(input: InviteInput) {
    const person = meOrThrow();
    if (person.role === 'operative') throw new Error('not_authorized');
    if (person.role === 'cm' && input.role !== 'operative') throw new Error('not_authorized');
    const invited: Person = {
      id: crypto.randomUUID(),
      company_id: person.company_id,
      role: input.role,
      trade: input.trade ?? null,
      display_name: input.displayName,
      email: input.email.toLowerCase(),
      phone: null,
      created_at: now(),
    };
    store.people.push(invited);
    if (input.siteId) {
      await this.addAssignment(input.siteId, invited.id);
    }
  },

  async getDrawingOpenUrl(drawing) {
    return pdfObjectUrl(drawing.id, drawing.title, drawing.revision, drawing.dated ?? '');
  },
};

export function resetFixtureStore() {
  store = seed();
  store.sessionPersonId = loadSessionId();
}
