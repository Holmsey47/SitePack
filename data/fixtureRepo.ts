import { normalizeCreateSite } from '@/data/createSite';
import { newId } from '@/data/newId';
import { inviteSiteIds, previewName } from '@/data/walk';
import { IDS, SEED_PASSWORD } from '@/data/ids';
import type { SitePackRepo, SignInResult } from '@/data/repo';
import type {
  AddNoLoginOperativeInput,
  CompanyContact,
  CompanyPerson,
  CreateRequestInput,
  Drawing,
  DrawingRequest,
  HomeSite,
  InviteInput,
  ManifestItem,
  PeopleGroup,
  Person,
  PulseRow,
  ReplaceDrawingInput,
  RequestStatus,
  SiteAssignment,
  Site,
} from '@/data/types';
import { resolveFolder, resolveLevel } from '@/data/folders';
import { canAssignPeopleGroup, canEditPeopleGroup, normalizeGroupName } from '@/data/peopleGroups';
import {
  JOIN_ALPHABET,
  JOIN_DEFAULT_HOURS,
  JOIN_DEFAULT_MAX_USES,
  JOIN_HARD_MAX_USES,
  JOIN_IP_WINDOW_MINUTES,
  JOIN_MAX_HOURS,
  JOIN_USERNAME_FAILURE_LIMIT,
  JOIN_REJECTED,
  RESET_CODE_MINUTES,
  hasDisplayNameControl,
  isJoinCodeShape,
  isUsernameShape,
  normalizeJoinCode,
  normalizeUsername,
  passwordHasLettersAndDigits,
} from '@/data/joinCodes';
import type { JoinCodeCreated, JoinCodeRow, JoinWithCodeInput, JoinerRow, PasswordResetIssued } from '@/data/types';
import { pdfObjectUrl } from '@/lib/pdf';
import type { CreateVariationInput, VariationDetail, VariationList } from '@/data/variations';
import {
  buildRoster,
  buildSiteSummary,
  confirmSeen,
  managerGaps,
  notSeenByOperative,
  recordOpen,
  unseenForPerson,
  type ProofOpen,
  type ProofSeen,
  type SeenAssignment,
} from '@/data/drawingSeen';
import {
  fixtureCreateVariation,
  fixtureListVariations,
  fixturePhotoUrl,
  fixtureReviseVariation,
  fixtureSendVariation,
  fixtureSetVariationValue,
  fixtureSignVariation,
  fixtureUpdateDraft,
  fixtureUploadPhoto,
  fixtureVariationDetail,
  seedFixtureVariations,
  type FixtureVariationBucket,
} from '@/data/fixtureVariations';
import {
  fixtureCreateSnag,
  fixtureFixSnag,
  fixtureListSnags,
  fixtureEditSignoff,
  fixtureSignOffSnags,
  fixtureSnagDetail,
  fixtureSnagPhotoUrl,
  fixtureSnagReport,
  fixtureSnagTrades,
  fixtureUploadSnagPhoto,
  seedFixtureSnags,
  type FixtureSnagBucket,
} from '@/data/fixtureSnags';
import type { CreateSnagInput, SignOffSnagsInput } from '@/data/snags';
import {
  emptyAttendance,
  fixtureAttendanceEntry,
  fixtureCorrect,
  fixtureListMine,
  fixtureMySiteAttendance,
  fixtureOnSiteNow,
  fixtureSignIn,
  fixtureSignOut,
  fixtureWeekly,
  type FixtureAttendanceBucket,
} from '@/data/fixtureAttendance';

type GroupRecord = {
  id: string;
  company_id: string;
  name: string;
  created_at: string;
  created_by: string | null;
  memberIds: string[];
};

type AssignmentSource = {
  site_assignment_id: string;
  group_id: string;
};

type JoinCodeRecord = {
  id: string;
  company_id: string;
  site_id: string;
  code: string;
  label: string | null;
  created_by: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  revoked_at: string | null;
  created_at: string;
};

type JoinEventRecord = {
  id: string;
  code_id: string;
  person_id: string | null;
  company_id: string;
  site_id: string;
  display_name: string;
  trade: string | null;
  username: string;
  joined_at: string;
  removed_at: string | null;
  removed_by: string | null;
};

type ResetCodeRecord = {
  id: string;
  person_id: string;
  code: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};

type FailureRow = { bucket: string; subject: string; at: number };

type Store = {
  people: Person[];
  sites: Site[];
  assignments: SiteAssignment[];
  assignmentGroups: AssignmentSource[];
  drawings: Drawing[];
  requests: DrawingRequest[];
  groups: GroupRecord[];
  sessionPersonId: string | null;
  joinCodes: JoinCodeRecord[];
  joinEvents: JoinEventRecord[];
  resetCodes: ResetCodeRecord[];
  failures: FailureRow[];
  passwords: Record<string, string>;
  banned: string[];
  companyName: string;
  codeSerial: number;
  variations: FixtureVariationBucket;
  snags: FixtureSnagBucket;
  attendance: FixtureAttendanceBucket;
  drawingOpens: ProofOpen[];
  drawingSeen: ProofSeen[];
};

const now = () => new Date().toISOString();

/** Four current set-out sheets so fixture mode can show the level filter. */
function setOutSheets(): Drawing[] {
  const rows: Array<{ id: string; title: string; sheet: string; level: string }> = [
    { id: '99999999-9999-9999-9999-999999999995', title: 'Set out Ground', sheet: 'SO-00', level: 'Ground' },
    { id: '99999999-9999-9999-9999-999999999996', title: 'Set out L1', sheet: 'SO-01', level: 'L1' },
    { id: '99999999-9999-9999-9999-999999999997', title: 'Set out L2', sheet: 'SO-02', level: 'L2' },
    { id: '99999999-9999-9999-9999-999999999998', title: 'Set out L3', sheet: 'SO-03', level: 'L3' },
  ];
  return rows.map((row) => ({
    id: row.id,
    site_id: IDS.oak,
    title: row.title,
    sheet_number: row.sheet,
    revision: 'A',
    dated: '2026-10-01',
    folder: 'Set out plans',
    level: row.level,
    is_current: true,
    supersedes_id: null,
    storage_path: `${IDS.company}/${IDS.oak}/${row.id}.pdf`,
    file_size_bytes: 4000,
    content_type: 'application/pdf',
    uploaded_by: IDS.cm,
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
  }));
}

function forgetAssignment(assignmentId: string) {
  store.assignmentGroups = store.assignmentGroups.filter((row) => row.site_assignment_id !== assignmentId);
}

function groupCovers(assignmentId: string): boolean {
  return store.assignmentGroups.some((row) => row.site_assignment_id === assignmentId);
}

function linkGroup(assignmentId: string, groupId: string) {
  const exists = store.assignmentGroups.some(
    (row) => row.site_assignment_id === assignmentId && row.group_id === groupId
  );
  if (!exists) store.assignmentGroups.push({ site_assignment_id: assignmentId, group_id: groupId });
}

function seed(): Store {
  const people: Person[] = [
    {
      id: IDS.owner,
      auth_user_id: IDS.owner,
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
      auth_user_id: IDS.cm,
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
      auth_user_id: IDS.amy,
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
      auth_user_id: IDS.ben,
      company_id: IDS.company,
      role: 'operative',
      trade: 'labourer',
      display_name: 'Ben Torres',
      email: 'ben@sitepack.test',
      phone: null,
      username: 'bentorres',
      created_at: '2026-08-01T09:00:00.000Z',
    },
    {
      id: IDS.lee,
      auth_user_id: null,
      company_id: IDS.company,
      role: 'operative',
      trade: 'dryliner',
      display_name: 'Lee Stone',
      email: null,
      phone: null,
      created_at: '2026-08-02T09:00:00.000Z',
    },
    {
      id: IDS.chris,
      auth_user_id: IDS.chris,
      company_id: IDS.company,
      role: 'operative',
      trade: 'dryliner',
      display_name: 'Chris Lang',
      email: 'chris@sitepack.test',
      phone: null,
      created_at: '2026-08-02T09:00:00.000Z',
    },
  ];

  const sites: Site[] = [
    {
      id: IDS.oak,
      company_id: IDS.company,
      name: 'Plot 12 – Oak Estate',
      address_line: 'Oak Estate, Phase 2',
      main_contractor: null,
      what_it_is: null,
      archived_at: null,
      created_at: '2026-09-06T09:00:00.000Z',
      updated_at: '2026-09-17T18:02:00.000Z',
    },
    {
      id: IDS.riverside,
      company_id: IDS.company,
      name: 'Plot 4 – Riverside',
      address_line: 'Riverside, Block B',
      main_contractor: null,
      what_it_is: null,
      archived_at: null,
      created_at: '2026-08-29T09:00:00.000Z',
      updated_at: '2026-08-29T09:00:00.000Z',
    },
    {
      id: IDS.warehouse,
      company_id: IDS.company,
      name: 'Warehouse – North Yard',
      address_line: 'North Yard compound',
      main_contractor: null,
      what_it_is: null,
      archived_at: null,
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
      folder: 'Ground floor',
      level: 'Ground',
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
      folder: 'Ground floor',
      level: 'Ground',
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
      folder: 'First floor',
      level: 'L1',
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
      folder: 'Other',
      level: null,
      is_current: true,
      supersedes_id: null,
      storage_path: `${IDS.company}/${IDS.warehouse}/${IDS.yard}.pdf`,
      file_size_bytes: 3900,
      content_type: 'application/pdf',
      uploaded_by: IDS.cm,
      created_at: '2026-09-12T09:00:00.000Z',
      updated_at: '2026-09-12T09:00:00.000Z',
    },
    ...setOutSheets(),
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

  const groups: GroupRecord[] = [
    {
      id: IDS.dryliners,
      company_id: IDS.company,
      name: 'Oak dryliners',
      created_at: '2026-09-01T09:00:00.000Z',
      created_by: IDS.owner,
      memberIds: [IDS.amy, IDS.ben, IDS.cm, IDS.lee, IDS.chris],
    },
  ];

  return {
    people,
    sites,
    assignments,
    assignmentGroups: [],
    drawings,
    requests,
    groups,
    sessionPersonId: null,
    joinCodes: [],
    joinEvents: [],
    resetCodes: [],
    failures: [],
    passwords: {},
    banned: [],
    companyName: 'Ashfield Finishes',
    codeSerial: 0,
    drawingOpens: [],
    drawingSeen: [],
    variations: seedFixtureVariations({
      companyId: IDS.company,
      oakId: IDS.oak,
      warehouseId: IDS.warehouse,
      amyId: IDS.amy,
      cmId: IDS.cm,
    }),
    snags: seedFixtureSnags({
      companyId: IDS.company,
      oakId: IDS.oak,
      warehouseId: IDS.warehouse,
      amyId: IDS.amy,
      benId: IDS.ben,
      cmId: IDS.cm,
    }),
    attendance: emptyAttendance(),
  };
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

function recentFailures(bucket: string, subject: string, minutes: number): number {
  const cutoff = Date.now() - minutes * 60 * 1000;
  return store.failures.filter((row) => row.bucket === bucket && row.subject === subject && row.at > cutoff).length;
}

function noteFailure(bucket: string, subject: string) {
  store.failures.push({ bucket, subject, at: Date.now() });
}

function usernameLimited(username: string): boolean {
  return recentFailures('login_user', username, JOIN_IP_WINDOW_MINUTES) >= JOIN_USERNAME_FAILURE_LIMIT;
}

function seenAssignments(): SeenAssignment[] {
  return store.assignments.flatMap((row) => {
    const person = store.people.find((item) => item.id === row.person_id);
    if (!person) return [];
    return [{ site_id: row.site_id, person_id: row.person_id, role: person.role }];
  });
}

/** Fixture-only. Marks the current sheet superseded and adds the next revision. */
export function devSupersedeCurrent(drawingId: string): { id: string; revision: string } | null {
  const old = store.drawings.find((row) => row.id === drawingId && row.is_current);
  if (!old) return null;
  const letter = old.revision.trim().slice(-1).toUpperCase();
  const revision = letter >= 'A' && letter < 'Z' ? String.fromCharCode(letter.charCodeAt(0) + 1) : `${old.revision}2`;
  old.is_current = false;
  const created: Drawing = {
    ...old,
    id: newId(),
    revision,
    is_current: true,
    supersedes_id: old.id,
    created_at: now(),
    updated_at: now(),
  };
  store.drawings.push(created);
  return { id: created.id, revision };
}

function meOrThrow(): Person {
  const person = store.people.find((p) => p.id === store.sessionPersonId);
  if (!person) throw new Error('not_authorized');
  return person;
}

function snagActor(person: Person) {
  return {
    id: person.id,
    role: person.role,
    company_id: person.company_id,
    display_name: person.display_name ?? '',
  };
}

function canAccessSite(person: Person, siteId: string): boolean {
  const site = store.sites.find((s) => s.id === siteId && s.company_id === person.company_id);
  if (!site) return false;
  if (person.role === 'owner') return true;
  return store.assignments.some((a) => a.site_id === siteId && a.person_id === person.id);
}

function sharesAssignedSite(caller: Person, target: Person): boolean {
  const mine = new Set(
    store.assignments.filter((assignment) => assignment.person_id === caller.id).map((assignment) => assignment.site_id)
  );
  return store.assignments.some((assignment) => assignment.person_id === target.id && mine.has(assignment.site_id));
}

function canSeePerson(caller: Person, target: Person): boolean {
  if (target.company_id !== caller.company_id) return false;
  if (caller.role === 'owner' || caller.id === target.id) return true;
  return sharesAssignedSite(caller, target);
}

function personForCaller(caller: Person, target: Person): Person {
  const own = caller.id === target.id;
  return {
    ...target,
    email: caller.role === 'owner' ? target.email : null,
    phone: caller.role === 'owner' ? target.phone : null,
    username: own ? target.username : null,
  };
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
    requester_name: requester?.display_name?.trim() || 'Unknown',
  };
}

function sheetKey(sheetNumber: string | null | undefined): string {
  return (sheetNumber ?? '').trim();
}

function requireManager(): Person {
  const person = meOrThrow();
  if (person.role !== 'owner' && person.role !== 'cm') throw new Error('not_authorized');
  return person;
}

function companyPersonView(person: Person): CompanyPerson {
  const siteNames = store.assignments
    .filter((assignment) => assignment.person_id === person.id)
    .map((assignment) => store.sites.find((site) => site.id === assignment.site_id && site.company_id === person.company_id)?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b));
  return {
    id: person.id,
    display_name: person.display_name,
    role: person.role,
    trade: person.trade,
    has_login: person.auth_user_id != null,
    username: person.username ?? null,
    site_names: siteNames,
  };
}

export function editSnagSignoffForTests(signoffId: string) {
  fixtureEditSignoff(store.snags, signoffId);
}

export function snagSignoffCountForTests(): number {
  return store.snags.signoffs.length;
}

export const fixtureRepo: SitePackRepo = {
  async signIn(email, password): Promise<SignInResult> {
    const person = store.people.find((p) => p.email?.toLowerCase() === email.trim().toLowerCase());
    if (!person || store.banned.includes(person.auth_user_id ?? person.id)) {
      throw new Error('Couldn’t sign in. Check email and password and try again.');
    }
    const expected = store.passwords[person.id] ?? SEED_PASSWORD;
    if (password !== expected) {
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
          level: d.level,
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
      id: newId(),
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
      .filter((r) => ids.includes(r.site_id) && r.status !== 'Closed')
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

  async deleteRequest(requestId) {
    const person = meOrThrow();
    if (person.role === 'operative') throw new Error('not_authorized');
    const row = store.requests.find((r) => r.id === requestId);
    if (!row || !canAccessSite(person, row.site_id)) throw new Error('not_authorized');
    store.requests = store.requests.filter((r) => r.id !== requestId);
  },

  async createSite(input) {
    const person = meOrThrow();
    if (person.role !== 'owner') throw new Error('not_authorized');
    const fields = normalizeCreateSite(input);
    const created: Site = {
      id: newId(),
      company_id: person.company_id,
      ...fields,
      archived_at: null,
      created_at: now(),
      updated_at: now(),
    };
    store.sites.push(created);
    return created;
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
        const people = store.assignments
          .filter((a) => a.site_id === s.id)
          .map((a) => store.people.find((p) => p.id === a.person_id))
          .filter((personOnSite): personOnSite is Person => Boolean(personOnSite));
        const names = people.map((personOnSite) => previewName(personOnSite.display_name)).sort();
        const managers = people
          .filter((personOnSite) => personOnSite.role === 'cm')
          .map((personOnSite) => previewName(personOnSite.display_name))
          .sort();
        return {
          site_id: s.id,
          name: s.name,
          address_line: s.address_line,
          assignee_count: names.length,
          assignee_names_preview: names.slice(0, 3),
          contracts_manager_names: managers,
          operative_count: people.filter((personOnSite) => personOnSite.role === 'operative').length,
          archived_at: s.archived_at,
          last_pack_update: s.updated_at,
          open_request_count: store.requests.filter((r) => r.site_id === s.id && r.status === 'Open').length,
          new_joiner_count: store.joinEvents.filter((event) => {
            if (event.site_id !== s.id || event.removed_at) return false;
            return Date.now() - new Date(event.joined_at).getTime() < 7 * 24 * 60 * 60 * 1000;
          }).length,
        };
      });
  },

  async archiveSite(siteId, archived) {
    const person = meOrThrow();
    if (person.role !== 'owner') throw new Error('not_authorized');
    const site = store.sites.find((row) => row.id === siteId && row.company_id === person.company_id);
    if (!site) throw new Error('site_not_found');
    site.archived_at = archived ? now() : null;
  },

  async contractsManagerNames(siteId) {
    const person = meOrThrow();
    if (!canAccessSite(person, siteId)) throw new Error('not_authorized');
    return store.assignments
      .filter((assignment) => assignment.site_id === siteId)
      .map((assignment) => store.people.find((row) => row.id === assignment.person_id))
      .filter((row) => row?.role === 'cm')
      .map((row) => row?.display_name?.trim() || 'Unknown')
      .sort();
  },

  async listAssignments(siteId) {
    const person = meOrThrow();
    if (!canAccessSite(person, siteId)) throw new Error('not_authorized');
    return store.assignments
      .filter((a) => a.site_id === siteId)
      .map((a) => {
        const target = store.people.find((p) => p.id === a.person_id);
        return { ...a, person: target ? personForCaller(person, target) : undefined };
      });
  },

  async addAssignment(siteId, personId) {
    const person = meOrThrow();
    if (person.role === 'operative' || !canAccessSite(person, siteId)) throw new Error('not_authorized');
    if (store.assignments.some((a) => a.site_id === siteId && a.person_id === personId)) return;
    store.assignments.push({
      id: newId(),
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
    forgetAssignment(assignmentId);
    store.assignments = store.assignments.filter((a) => a.id !== assignmentId);
  },

  async listCompanyPeople() {
    const person = meOrThrow();
    return store.people
      .filter((candidate) => canSeePerson(person, candidate))
      .map((candidate) => personForCaller(person, candidate));
  },

  async companyContacts(): Promise<CompanyContact[]> {
    const person = meOrThrow();
    if (person.role !== 'owner') throw new Error('not_authorized');
    return store.people
      .filter((candidate) => candidate.company_id === person.company_id)
      .map((candidate) => ({ id: candidate.id, email: candidate.email, phone: candidate.phone }))
      .sort((a, b) => a.id.localeCompare(b.id));
  },

  async companyPeople() {
    const person = requireManager();
    return store.people
      .filter((candidate) => canSeePerson(person, candidate))
      .map(companyPersonView)
      .sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '') || a.id.localeCompare(b.id));
  },

  async addNoLoginOperative(input: AddNoLoginOperativeInput) {
    const caller = requireManager();
    const name = input.displayName.trim();
    if (!name) throw new Error('name_required');
    const trade = input.trade?.trim() || null;
    const siteIds = [...new Set(input.siteIds)];
    if (caller.role === 'cm' && siteIds.length === 0) throw new Error('not_authorized');
    for (const siteId of siteIds) {
      const site = store.sites.find((row) => row.id === siteId && row.company_id === caller.company_id);
      if (!site) throw new Error('site_not_found');
      if (
        caller.role === 'cm' &&
        !store.assignments.some((assignment) => assignment.site_id === siteId && assignment.person_id === caller.id)
      ) {
        throw new Error('not_authorized');
      }
    }
    const created: Person = {
      id: newId(),
      auth_user_id: null,
      company_id: caller.company_id,
      role: 'operative',
      trade,
      display_name: name,
      email: null,
      phone: null,
      created_at: now(),
    };
    store.people.push(created);
    for (const siteId of siteIds) {
      store.assignments.push({
        id: newId(),
        site_id: siteId,
        person_id: created.id,
        created_at: now(),
      });
    }
    return created.id;
  },

  async removeOperativeFromSite(personId, siteId) {
    const caller = requireManager();
    const target = store.people.find((p) => p.id === personId && p.company_id === caller.company_id);
    if (!target || target.role !== 'operative') throw new Error('not_authorized');
    const site = store.sites.find((row) => row.id === siteId && row.company_id === caller.company_id);
    if (!site) throw new Error('site_not_found');
    if (
      caller.role === 'cm' &&
      !store.assignments.some((assignment) => assignment.site_id === siteId && assignment.person_id === caller.id)
    ) {
      throw new Error('not_authorized');
    }
    const gone = store.assignments.filter(
      (assignment) => assignment.site_id === siteId && assignment.person_id === personId
    );
    for (const row of gone) forgetAssignment(row.id);
    store.assignments = store.assignments.filter(
      (assignment) => !(assignment.site_id === siteId && assignment.person_id === personId)
    );
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
      id: input.id ?? newId(),
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
      folder: resolveFolder(input.folder, old?.folder),
      level: resolveLevel(input.level, old?.level),
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
    const siteIds = inviteSiteIds(input);
    for (const siteId of siteIds) {
      const site = store.sites.find((row) => row.id === siteId && row.company_id === person.company_id);
      if (!site) throw new Error('site_not_found');
      if (
        person.role === 'cm' &&
        !store.assignments.some((assignment) => assignment.site_id === siteId && assignment.person_id === person.id)
      ) {
        throw new Error('not_authorized');
      }
    }
    const invited: Person = {
      id: newId(),
      auth_user_id: newId(),
      company_id: person.company_id,
      role: input.role,
      trade: input.trade ?? null,
      display_name: input.displayName,
      email: input.email.trim().toLowerCase(),
      phone: null,
      created_at: now(),
    };
    store.people.push(invited);
    for (const siteId of siteIds) {
      await this.addAssignment(siteId, invited.id);
    }
  },

  async attachLogin(personId, email) {
    const caller = requireManager();
    const cleaned = email.trim().toLowerCase();
    if (!cleaned) throw new Error('email_required');
    const target = store.people.find((p) => p.id === personId && p.company_id === caller.company_id);
    if (!target || target.role !== 'operative') throw new Error('not_authorized');
    if (target.auth_user_id) throw new Error('already_has_login');
    const taken = store.people.some(
      (p) => p.id !== target.id && p.company_id === caller.company_id && p.email?.trim().toLowerCase() === cleaned
    );
    if (taken) throw new Error('email_in_use');
    if (caller.role === 'cm') {
      const mine = new Set(
        store.assignments.filter((assignment) => assignment.person_id === caller.id).map((assignment) => assignment.site_id)
      );
      const shared = store.assignments.some((assignment) => assignment.person_id === target.id && mine.has(assignment.site_id));
      if (!shared) throw new Error('not_authorized');
    }
    target.email = cleaned;
    target.auth_user_id = newId();
  },

  async signInWithUsername(username, password): Promise<SignInResult> {
    const name = normalizeUsername(username);
    const subject = name || 'bad';
    const noteMiss = () => {
      noteFailure('login_user', subject);
      noteFailure('login_ip', 'fixture');
      noteFailure('login_global', 'all');
    };
    if (usernameLimited(subject)) {
      noteMiss();
      throw new Error('sign_in_failed');
    }
    const person = store.people.find((row) => row.username === name && row.auth_user_id);
    if (!person || !person.auth_user_id || store.banned.includes(person.auth_user_id)) {
      noteMiss();
      throw new Error('sign_in_failed');
    }
    const expected = store.passwords[person.id] ?? SEED_PASSWORD;
    if (!passwordHasLettersAndDigits(password) || password !== expected) {
      noteMiss();
      throw new Error('sign_in_failed');
    }
    store.sessionPersonId = person.id;
    saveSessionId(person.id);
    return { person, needsPassword: false };
  },

  async companyName() {
    return store.companyName;
  },

  async listVariations(siteId): Promise<VariationList> {
    const actor = meOrThrow();
    const site = store.sites.find((row) => row.id === siteId);
    return fixtureListVariations(store.variations, actor, siteId, site?.company_id, canAccessSite(actor, siteId));
  },

  async getVariation(variationId): Promise<VariationDetail | null> {
    const actor = meOrThrow();
    return fixtureVariationDetail(
      store.variations,
      actor,
      variationId,
      (siteId) => canAccessSite(actor, siteId),
      (siteId) => store.sites.find((row) => row.id === siteId)?.company_id
    );
  },

  async createVariation(input: CreateVariationInput) {
    const actor = meOrThrow();
    const site = store.sites.find((row) => row.id === input.siteId);
    return fixtureCreateVariation(store.variations, actor, input, site?.company_id, canAccessSite(actor, input.siteId));
  },

  async updateVariationDraft(versionId, input) {
    const actor = meOrThrow();
    fixtureUpdateDraft(store.variations, actor, versionId, input, (siteId) => canAccessSite(actor, siteId));
  },

  async setVariationValue(versionId, valuePence) {
    const actor = meOrThrow();
    fixtureSetVariationValue(store.variations, actor, versionId, valuePence, (siteId) => canAccessSite(actor, siteId));
  },

  async signVariation(versionId, input) {
    const actor = meOrThrow();
    fixtureSignVariation(store.variations, actor, versionId, input, (siteId) => canAccessSite(actor, siteId));
  },

  async sendVariation(versionId) {
    const actor = meOrThrow();
    fixtureSendVariation(store.variations, actor, versionId, (siteId) => canAccessSite(actor, siteId));
  },

  async reviseVariation(versionId) {
    const actor = meOrThrow();
    return fixtureReviseVariation(store.variations, actor, versionId, (siteId) => canAccessSite(actor, siteId));
  },

  async uploadSitePhoto(params) {
    meOrThrow();
    if (params.folder === 'snags') {
      return fixtureUploadSnagPhoto(store.snags, params.companyId, params.siteId, params.bytes, params.contentType);
    }
    return fixtureUploadPhoto(store.variations, params.companyId, params.siteId, params.bytes, params.contentType);
  },

  async signSitePhotoUrl(storagePath) {
    meOrThrow();
    const signed = fixturePhotoUrl(store.variations, storagePath) ?? fixtureSnagPhotoUrl(store.snags, storagePath);
    if (!signed) throw new Error('not_found');
    return signed;
  },

  async listSnags(siteId) {
    const person = meOrThrow();
    const site = store.sites.find((row) => row.id === siteId);
    return fixtureListSnags(store.snags, snagActor(person), siteId, site?.company_id, canAccessSite(person, siteId));
  },

  async snagReport(siteId) {
    const person = meOrThrow();
    const site = store.sites.find((row) => row.id === siteId);
    return { rows: fixtureSnagReport(store.snags, snagActor(person), siteId, site?.company_id, canAccessSite(person, siteId)) };
  },

  async getSnag(snagId) {
    const person = meOrThrow();
    return fixtureSnagDetail(
      store.snags,
      snagActor(person),
      snagId,
      (id) => canAccessSite(person, id),
      (id) => store.sites.find((row) => row.id === id)?.company_id
    );
  },

  async createSnag(input: CreateSnagInput) {
    const person = meOrThrow();
    const site = store.sites.find((row) => row.id === input.siteId);
    return fixtureCreateSnag(store.snags, snagActor(person), input, site?.company_id, canAccessSite(person, input.siteId));
  },

  async fixSnag(snagId, fixedAt, photos, fixId) {
    const person = meOrThrow();
    return fixtureFixSnag(store.snags, snagActor(person), snagId, fixedAt, photos, (id) => canAccessSite(person, id), fixId);
  },

  async removeSitePhotos() {
    return;
  },

  async signOffSnagsInternal(input: SignOffSnagsInput) {
    const person = meOrThrow();
    return fixtureSignOffSnags(
      store.snags,
      snagActor(person),
      input,
      'internal',
      (id) => canAccessSite(person, id),
      (id) => store.sites.find((row) => row.id === id)?.company_id
    );
  },

  async signOffSnagsContractor(input: SignOffSnagsInput) {
    const person = meOrThrow();
    return fixtureSignOffSnags(
      store.snags,
      snagActor(person),
      input,
      'contractor',
      (id) => canAccessSite(person, id),
      (id) => store.sites.find((row) => row.id === id)?.company_id
    );
  },

  async snagTradeLabels(siteId) {
    const person = meOrThrow();
    const site = store.sites.find((row) => row.id === siteId);
    return fixtureSnagTrades(store.people, store.assignments, snagActor(person), siteId, site?.company_id, canAccessSite(person, siteId));
  },

  async signInSite(siteId, deviceAt) {
    const person = meOrThrow();
    const site = store.sites.find((row) => row.id === siteId);
    return fixtureSignIn(
      store.attendance,
      snagActor(person),
      siteId,
      site?.company_id,
      canAccessSite(person, siteId),
      deviceAt,
      undefined,
      (id) => store.sites.find((row) => row.id === id)?.name
    );
  },

  async signOutSite(siteId, deviceAt) {
    const person = meOrThrow();
    const site = store.sites.find((row) => row.id === siteId);
    return fixtureSignOut(store.attendance, snagActor(person), siteId, site?.company_id, canAccessSite(person, siteId), deviceAt);
  },

  async mySiteAttendance(siteId) {
    const person = meOrThrow();
    const site = store.sites.find((row) => row.id === siteId);
    return fixtureMySiteAttendance(store.attendance, snagActor(person), siteId, site?.company_id, canAccessSite(person, siteId));
  },

  async listMyAttendance(siteId) {
    const person = meOrThrow();
    const site = store.sites.find((row) => row.id === siteId);
    return fixtureListMine(store.attendance, snagActor(person), siteId, site?.company_id, canAccessSite(person, siteId));
  },

  async listOnSiteNow(siteId) {
    const person = meOrThrow();
    const site = store.sites.find((row) => row.id === siteId);
    return fixtureOnSiteNow(store.attendance, snagActor(person), siteId, site?.company_id, canAccessSite(person, siteId));
  },

  async weeklyAttendance(siteId, weekStart) {
    const person = meOrThrow();
    const site = store.sites.find((row) => row.id === siteId);
    return fixtureWeekly(store.attendance, snagActor(person), siteId, site?.company_id, canAccessSite(person, siteId), weekStart);
  },

  async attendanceEntry(entryId) {
    const person = meOrThrow();
    return fixtureAttendanceEntry(store.attendance, snagActor(person), entryId, (id) => canAccessSite(person, id));
  },

  async correctAttendance(entryId, inAt, outAt, reason) {
    const person = meOrThrow();
    return fixtureCorrect(store.attendance, snagActor(person), entryId, inAt, outAt, reason, (id) => canAccessSite(person, id));
  },

  async createJoinCode(input): Promise<JoinCodeCreated> {
    const actor = requireManager();
    const site = store.sites.find((row) => row.id === input.siteId && row.company_id === actor.company_id);
    if (!site || site.archived_at || !canAccessSite(actor, site.id)) throw new Error('not_authorized');
    const label = input.label?.trim() || null;
    if (label && label.length > 40) throw new Error('label_too_long');
    const maxUses = input.maxUses ?? JOIN_DEFAULT_MAX_USES;
    const hours = input.hours ?? JOIN_DEFAULT_HOURS;
    if (maxUses < 1 || maxUses > JOIN_HARD_MAX_USES) throw new Error('cap_out_of_range');
    if (hours < 1 || hours > JOIN_MAX_HOURS) throw new Error('expiry_out_of_range');
    store.codeSerial += 1;
    let serial = store.codeSerial + 19873456218;
    let code = '';
    for (let i = 0; i < 8; i += 1) {
      code = JOIN_ALPHABET[serial % JOIN_ALPHABET.length] + code;
      serial = Math.floor(serial / JOIN_ALPHABET.length);
    }
    const created: JoinCodeRecord = {
      id: newId(),
      company_id: actor.company_id,
      site_id: site.id,
      code,
      label,
      created_by: actor.id,
      expires_at: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
      max_uses: maxUses,
      uses: 0,
      revoked_at: null,
      created_at: now(),
    };
    store.joinCodes.push(created);
    return {
      id: created.id,
      code: `${code.slice(0, 4)}-${code.slice(4)}`,
      expires_at: created.expires_at,
      max_uses: maxUses,
      label,
      site_id: site.id,
      site_name: site.name,
      company_name: store.companyName,
    };
  },

  async listJoinCodes(siteId): Promise<JoinCodeRow[]> {
    const actor = requireManager();
    const site = store.sites.find((row) => row.id === siteId && row.company_id === actor.company_id);
    if (!site || !canAccessSite(actor, siteId)) throw new Error('not_authorized');
    if (site.archived_at) return [];
    return store.joinCodes
      .filter((row) => row.site_id === siteId && row.company_id === actor.company_id)
      .map((row) => ({
        id: row.id,
        site_id: row.site_id,
        label: row.label,
        expires_at: row.expires_at,
        max_uses: row.max_uses,
        uses: row.uses,
        revoked_at: row.revoked_at,
        created_at: row.created_at,
      }));
  },

  async revokeJoinCode(codeId) {
    const actor = requireManager();
    const row = store.joinCodes.find((code) => code.id === codeId && code.company_id === actor.company_id);
    if (!row || !canAccessSite(actor, row.site_id)) throw new Error('not_authorized');
    row.revoked_at = row.revoked_at ?? now();
  },

  async listJoiners(siteId): Promise<JoinerRow[]> {
    const actor = requireManager();
    if (!canAccessSite(actor, siteId)) throw new Error('not_authorized');
    return store.joinEvents
      .filter((event) => event.site_id === siteId && event.company_id === actor.company_id)
      .sort((a, b) => b.joined_at.localeCompare(a.joined_at))
      .map((event) => ({
        id: event.id,
        person_id: event.person_id,
        display_name: event.display_name,
        trade: event.trade,
        username: event.username,
        joined_at: event.joined_at,
        removed_at: event.removed_at,
        code_id: event.code_id,
        code_label: store.joinCodes.find((code) => code.id === event.code_id)?.label ?? null,
      }));
  },

  async joinWithCode(input: JoinWithCodeInput) {
    if (!passwordHasLettersAndDigits(input.password)) throw new Error('weak_password');
    const displayName = input.displayName.trim();
    if (hasDisplayNameControl(displayName)) throw new Error('invalid_display_name');
    const username = normalizeUsername(input.username);
    const trade = input.trade.trim();
    if (!displayName || displayName.length > 80 || trade.length > 80 || !isUsernameShape(username)) {
      throw new Error('invalid_input');
    }
    const normalized = normalizeJoinCode(input.code);
    const code = isJoinCodeShape(normalized)
      ? store.joinCodes.find((row) => row.code === normalized)
      : undefined;
    const site = code ? store.sites.find((row) => row.id === code.site_id) : undefined;
    const rejected =
      !code ||
      code.revoked_at != null ||
      new Date(code.expires_at).getTime() <= Date.now() ||
      code.uses >= code.max_uses ||
      site?.archived_at != null;
    if (rejected || !code) {
      noteFailure('ip', 'fixture');
      noteFailure('global', 'all');
      throw new Error(JOIN_REJECTED);
    }
    if (store.people.some((person) => person.username === username)) {
      throw new Error('username_taken');
    }
    const person: Person = {
      id: newId(),
      auth_user_id: newId(),
      company_id: code.company_id,
      role: 'operative',
      trade: trade || null,
      display_name: displayName,
      email: null,
      phone: null,
      username,
      created_at: now(),
    };
    store.people.push(person);
    store.passwords[person.id] = input.password;
    store.assignments.push({
      id: newId(),
      site_id: code.site_id,
      person_id: person.id,
      created_at: now(),
    });
    store.joinEvents.push({
      id: newId(),
      code_id: code.id,
      person_id: person.id,
      company_id: code.company_id,
      site_id: code.site_id,
      display_name: displayName,
      trade: person.trade,
      username,
      joined_at: now(),
      removed_at: null,
      removed_by: null,
    });
    code.uses += 1;
    store.sessionPersonId = person.id;
    saveSessionId(person.id);
    return { person, siteId: code.site_id };
  },

  async removeJoiner(personId, siteId, revokeCode) {
    const actor = requireManager();
    const person = store.people.find((row) => row.id === personId);
    if (!person || person.role !== 'operative' || person.company_id !== actor.company_id) {
      throw new Error('not_authorized');
    }
    if (!canAccessSite(actor, siteId)) throw new Error('not_authorized');
    const events = store.joinEvents.filter((event) => event.person_id === personId && event.site_id === siteId);
    if (actor.role === 'cm') {
      const live = events.find((event) => !event.removed_at);
      const code = live ? store.joinCodes.find((row) => row.id === live.code_id) : undefined;
      const creator = store.people.find((row) => row.id === code?.created_by);
      if (!live || creator?.role !== 'cm') throw new Error('not_authorized');
      live.removed_at = now();
      live.removed_by = actor.id;
      if (revokeCode && code) code.revoked_at = code.revoked_at ?? now();
      const dropped = store.assignments.filter(
        (assignment) => assignment.person_id === personId && assignment.site_id === siteId
      );
      for (const assignment of dropped) forgetAssignment(assignment.id);
      store.assignments = store.assignments.filter(
        (assignment) => !(assignment.person_id === personId && assignment.site_id === siteId)
      );
      return;
    }
    if (
      events.length === 0 &&
      !store.assignments.some((assignment) => assignment.person_id === personId && assignment.site_id === siteId)
    ) {
      throw new Error('not_authorized');
    }
    for (const event of events) {
      event.removed_at = event.removed_at ?? now();
      event.removed_by = actor.id;
      if (revokeCode) {
        const code = store.joinCodes.find((row) => row.id === event.code_id);
        if (code) code.revoked_at = code.revoked_at ?? now();
      }
    }
    const authId = person.auth_user_id;
    const dropped = store.assignments.filter((assignment) => assignment.person_id === personId);
    for (const assignment of dropped) forgetAssignment(assignment.id);
    store.assignments = store.assignments.filter((assignment) => assignment.person_id !== personId);
    const referenced = store.requests.some((request) => request.requester_id === personId);
    if (referenced) {
      person.auth_user_id = null;
      person.username = null;
    } else {
      store.people = store.people.filter((row) => row.id !== personId);
    }
    if (authId) store.banned.push(authId);
    if (store.sessionPersonId === personId) {
      store.sessionPersonId = null;
      saveSessionId(null);
    }
  },

  async issuePasswordReset(personId): Promise<PasswordResetIssued> {
    const actor = requireManager();
    const target = store.people.find((row) => row.id === personId);
    if (!target || target.company_id !== actor.company_id || target.role !== 'operative' || !target.auth_user_id) {
      throw new Error('not_authorized');
    }
    if (actor.role === 'cm' && !sharesAssignedSite(actor, target)) throw new Error('not_authorized');
    for (const existing of store.resetCodes) {
      if (existing.person_id === target.id && !existing.used_at) existing.revoked_at = existing.revoked_at ?? now();
    }
    store.codeSerial += 1;
    let serial = store.codeSerial + 8642997131;
    let code = '';
    for (let i = 0; i < 8; i += 1) {
      code = JOIN_ALPHABET[serial % JOIN_ALPHABET.length] + code;
      serial = Math.floor(serial / JOIN_ALPHABET.length);
    }
    store.resetCodes.push({
      id: newId(),
      person_id: target.id,
      code,
      expires_at: new Date(Date.now() + RESET_CODE_MINUTES * 60 * 1000).toISOString(),
      used_at: null,
      revoked_at: null,
    });
    return {
      code: `${code.slice(0, 4)}-${code.slice(4)}`,
      expires_at: store.resetCodes[store.resetCodes.length - 1].expires_at,
      person_id: target.id,
    };
  },

  async redeemPasswordReset(code, password) {
    if (!passwordHasLettersAndDigits(password)) throw new Error('weak_password');
    const normalized = normalizeJoinCode(code);
    const row = isJoinCodeShape(normalized) ? store.resetCodes.find((item) => item.code === normalized) : undefined;
    const rejected =
      !row || row.used_at != null || row.revoked_at != null || new Date(row.expires_at).getTime() <= Date.now();
    if (rejected || !row) {
      noteFailure('reset_ip', 'fixture');
      noteFailure('reset_global', 'all');
      throw new Error('reset_rejected');
    }
    const person = store.people.find((item) => item.id === row.person_id && item.role === 'operative');
    if (!person) {
      noteFailure('reset_ip', 'fixture');
      noteFailure('reset_global', 'all');
      throw new Error('reset_rejected');
    }
    row.used_at = now();
    person.password_reset_at = now();
    store.passwords[person.id] = password;
  },

  async acknowledgePasswordReset() {
    const person = meOrThrow();
    person.password_reset_at = null;
  },

  async getDrawingOpenUrl(drawing) {
    return pdfObjectUrl(drawing.id, drawing.title, drawing.revision, drawing.dated ?? '');
  },

  async listPeopleGroups() {
    const person = meOrThrow();
    if (!canAssignPeopleGroup(person.role)) throw new Error('not_authorized');
    return store.groups
      .filter((group) => group.company_id === person.company_id)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((group) => groupForCaller(person, group));
  },

  async createPeopleGroup(name) {
    const person = meOrThrow();
    if (!canEditPeopleGroup(person.role)) throw new Error('not_authorized');
    const trimmed = normalizeGroupName(name);
    assertGroupNameFree(person.company_id, trimmed);
    const created: GroupRecord = {
      id: newId(),
      company_id: person.company_id,
      name: trimmed,
      created_at: now(),
      created_by: person.id,
      memberIds: [],
    };
    store.groups.push(created);
    return created.id;
  },

  async renamePeopleGroup(groupId, name) {
    const person = meOrThrow();
    if (!canEditPeopleGroup(person.role)) throw new Error('not_authorized');
    const group = findOwnGroup(person, groupId);
    const trimmed = normalizeGroupName(name);
    assertGroupNameFree(person.company_id, trimmed, group.id);
    group.name = trimmed;
  },

  async deletePeopleGroup(groupId) {
    const person = meOrThrow();
    if (!canEditPeopleGroup(person.role)) throw new Error('not_authorized');
    findOwnGroup(person, groupId);
    store.assignmentGroups = store.assignmentGroups.filter((row) => row.group_id !== groupId);
    store.groups = store.groups.filter((group) => group.id !== groupId);
  },

  async setPeopleGroupMembers(groupId, personIds) {
    const person = meOrThrow();
    if (!canEditPeopleGroup(person.role)) throw new Error('not_authorized');
    const group = findOwnGroup(person, groupId);
    if (personIds.some((id) => !id)) throw new Error('person_not_in_company');
    const ids = [...new Set(personIds)];
    for (const id of ids) {
      const row = store.people.find((candidate) => candidate.id === id);
      if (!row || row.company_id !== person.company_id) throw new Error('person_not_in_company');
    }
    group.memberIds = ids;
  },

  async assignGroupToSites(groupId, siteIds) {
    const person = meOrThrow();
    if (!canAssignPeopleGroup(person.role)) throw new Error('not_authorized');
    const group = findOwnGroup(person, groupId);
    for (const memberId of group.memberIds) {
      const row = store.people.find((candidate) => candidate.id === memberId);
      if (!row || row.company_id !== group.company_id) throw new Error('person_not_in_company');
    }
    const uniqueSites = [...new Set(siteIds)];
    if (uniqueSites.length === 0) throw new Error('site_required');
    for (const siteId of uniqueSites) {
      const site = store.sites.find((row) => row.id === siteId && row.company_id === person.company_id);
      if (!site) throw new Error('site_not_found');
      if (person.role === 'cm' && !canAccessSite(person, siteId)) throw new Error('not_authorized');
    }
    let added = 0;
    for (const siteId of uniqueSites) {
      for (const memberId of group.memberIds) {
        const existing = store.assignments.find((row) => row.site_id === siteId && row.person_id === memberId);
        if (!existing) {
          const id = newId();
          store.assignments.push({
            id,
            site_id: siteId,
            person_id: memberId,
            created_at: now(),
          });
          linkGroup(id, group.id);
          added += 1;
          continue;
        }
        if (groupCovers(existing.id)) linkGroup(existing.id, group.id);
      }
    }
    return { added };
  },

  async removeGroupFromSite(groupId, siteId) {
    const person = meOrThrow();
    if (!canAssignPeopleGroup(person.role)) throw new Error('not_authorized');
    const group = findOwnGroup(person, groupId);
    const site = store.sites.find((row) => row.id === siteId && row.company_id === person.company_id);
    if (!site) throw new Error('site_not_found');
    if (person.role === 'cm' && !canAccessSite(person, siteId)) throw new Error('not_authorized');
    const touched = store.assignments.filter((row) => {
      if (row.site_id !== siteId) return false;
      return store.assignmentGroups.some(
        (source) => source.site_assignment_id === row.id && source.group_id === group.id
      );
    });
    store.assignmentGroups = store.assignmentGroups.filter(
      (source) =>
        !(
          source.group_id === group.id &&
          touched.some((row) => row.id === source.site_assignment_id)
        )
    );
    let removed = 0;
    for (const row of touched) {
      if (groupCovers(row.id)) continue;
      const member = store.people.find((candidate) => candidate.id === row.person_id);
      if (member && (member.role === 'owner' || member.role === 'cm' || member.id === person.id)) continue;
      forgetAssignment(row.id);
      store.assignments = store.assignments.filter((assignment) => assignment.id !== row.id);
      removed += 1;
    }
    return { removed };
  },

  async listMyUnseenDrawings() {
    const person = meOrThrow();
    const names = new Map(store.sites.map((site) => [site.id, site.name]));
    return unseenForPerson(person.id, store.drawings, seenAssignments(), store.drawingSeen, names);
  },

  async myDrawingProof(drawingId) {
    const person = meOrThrow();
    const drawing = store.drawings.find((row) => row.id === drawingId);
    if (!drawing) throw new Error('drawing_not_found');
    if (!canAccessSite(person, drawing.site_id)) throw new Error('not_authorized');
    const seen = store.drawingSeen.find(
      (row) => row.drawing_id === drawing.id && row.person_id === person.id && row.revision === drawing.revision
    );
    return {
      drawing_id: drawing.id,
      site_id: drawing.site_id,
      revision: drawing.revision,
      is_current: drawing.is_current,
      assigned: store.assignments.some((row) => row.site_id === drawing.site_id && row.person_id === person.id),
      opened: store.drawingOpens.some(
        (row) => row.drawing_id === drawing.id && row.person_id === person.id && row.revision === drawing.revision
      ),
      seen_at: seen?.seen_at ?? null,
    };
  },

  async siteDrawingSeen(siteId) {
    const person = requireManager();
    if (!canAccessSite(person, siteId)) throw new Error('not_authorized');
    return buildSiteSummary(siteId, store.drawings, seenAssignments(), store.drawingSeen);
  },

  async drawingSeenRoster(drawingId) {
    const person = requireManager();
    const drawing = store.drawings.find((row) => row.id === drawingId);
    if (!drawing) throw new Error('drawing_not_found');
    if (!canAccessSite(person, drawing.site_id)) throw new Error('not_authorized');
    return buildRoster(drawing, seenAssignments(), store.people, store.drawingSeen);
  },

  async managerDrawingGaps() {
    const person = requireManager();
    const sites = store.sites.filter((site) => canAccessSite(person, site.id)).map((site) => site.id);
    return managerGaps(store.drawings, seenAssignments(), store.drawingSeen, sites);
  },

  async siteNotSeen(siteId) {
    const person = requireManager();
    if (!canAccessSite(person, siteId)) throw new Error('not_authorized');
    return notSeenByOperative(siteId, store.drawings, seenAssignments(), store.people, store.drawingSeen);
  },

  async recordDrawingOpen(drawingId) {
    const person = meOrThrow();
    const drawing = store.drawings.find((row) => row.id === drawingId);
    if (!drawing || !canAccessSite(person, drawing.site_id)) throw new Error('drawing_not_found');
    if (!drawing.is_current) throw new Error('not_current');
    recordOpen(store.drawingOpens, {
      drawing_id: drawing.id,
      site_id: drawing.site_id,
      person_id: person.id,
      revision: drawing.revision,
    });
  },

  async confirmDrawingSeen(drawingId, seenAt) {
    const person = meOrThrow();
    const drawing = store.drawings.find((row) => row.id === drawingId);
    if (!drawing || !canAccessSite(person, drawing.site_id)) throw new Error('drawing_not_found');
    if (!drawing.is_current) throw new Error('not_current');
    const row = confirmSeen(store.drawingOpens, store.drawingSeen, {
      drawing_id: drawing.id,
      site_id: drawing.site_id,
      person_id: person.id,
      revision: drawing.revision,
      seen_at: seenAt ?? null,
      received_at: new Date().toISOString(),
    });
    return { seenAt: row.seen_at };
  },
};

function groupForCaller(caller: Person, group: GroupRecord): PeopleGroup {
  return {
    id: group.id,
    company_id: group.company_id,
    name: group.name,
    created_at: group.created_at,
    created_by: group.created_by,
    members: group.memberIds.map((personId) => {
      const row = store.people.find((candidate) => candidate.id === personId);
      const visible = Boolean(row && canSeePerson(caller, row));
      return {
        person_id: personId,
        display_name: visible && row ? row.display_name : null,
        role: visible && row ? row.role : null,
        trade: visible && row ? row.trade : null,
        has_login: visible && row ? row.auth_user_id != null : null,
      };
    }),
  };
}

function findOwnGroup(caller: Person, groupId: string): GroupRecord {
  const group = store.groups.find((row) => row.id === groupId && row.company_id === caller.company_id);
  if (!group) throw new Error('not_authorized');
  return group;
}

function assertGroupNameFree(companyId: string, name: string, exceptId?: string) {
  const taken = store.groups.some(
    (group) =>
      group.company_id === companyId &&
      group.id !== exceptId &&
      group.name.toLowerCase() === name.toLowerCase()
  );
  if (taken) throw new Error('name_in_use');
}

export function resetFixtureStore() {
  store = seed();
  store.sessionPersonId = loadSessionId();
}
