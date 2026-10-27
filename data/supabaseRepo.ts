import { normalizeCreateSite } from '@/data/createSite';
import { assertLogoUpload, logoObjectPath } from '@/data/companyLogo';
import { CHECK_YOUR_EMAIL, parseStartCompany } from '@/data/startCompany';
import { newId } from '@/data/newId';
import { inviteSiteIds } from '@/data/walk';
import { inviteFailureMessage } from '@/data/inviteError';
import { groupCount } from '@/data/peopleGroups';
import type { SitePackRepo, SignInResult } from '@/data/repo';
import { rpcErrorCode } from '@/data/repo';
import type {
  CreateVariationInput,
  VariationDetail,
  VariationList,
  VariationPhoto,
  VariationStatus,
  VariationVersion,
} from '@/data/variations';
import { PHOTO_URL_SECONDS } from '@/data/variations';
import type { CreateSnagInput, SignOffSnagsInput, SnagDetail, SnagList, SnagPhoto, SnagReport, SnagSignoff, SnagStatus } from '@/data/snags';
import {
  parseDrawingProof,
  parseDrawingRoster,
  parseNotSeenPeople,
  parseSeenAt,
  parseSiteSeenGaps,
  parseSiteSeenSummary,
  parseUnseenDrawings,
} from '@/data/drawingSeen';
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
  PeopleGroupMember,
  Person,
  JoinCodeCreated,
  JoinCodeRow,
  JoinWithCodeInput,
  JoinerRow,
  PasswordResetIssued,
  PulseRow,
  ReplaceDrawingInput,
  Role,
  Site,
} from '@/data/types';
import { snagRpcError, snagStorageError, throwSnagRpc } from '@/data/snagFailure';
import {
  isSiteDocumentKind,
  siteDocumentBytesError,
  siteDocumentPath,
  type CreateSiteDocumentInput,
  type ReplaceSiteDocumentInput,
  type SignSiteDocumentInput,
  type SiteDocumentDetail,
  type SiteDocumentKind,
  type SiteDocumentSignature,
  type SiteDocumentSummary,
} from '@/data/siteDocuments';
import { getSupabase } from '@/lib/supabase';
import { pathsToClear } from '@/data/drawingDelete';
import { uploadBytes } from '@/lib/uploadBytes';
import { Platform } from 'react-native';

function unwrap<T>(
  data: T | null,
  error: { message: string; details?: string | null; code?: string | null; status?: number } | null,
  fallback?: string
): T {
  if (error) throw snagRpcError(error);
  if (data == null) throw new Error(fallback ?? 'not_found');
  return data;
}

function maybe<T>(data: T | null, error: { message: string } | null): T | null {
  if (error) throw new Error(error.message);
  return data;
}

async function documentRows(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

async function rpcJson(name: string, args: Record<string, unknown>) {
  return throwSnagRpc(await getSupabase().rpc(name, args));
}

/** Rows are already gone. Clear orphan records only for objects the bucket dropped. */
async function removeDrawingObjects(paths: string[]) {
  if (paths.length === 0) return;
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from('drawings').remove(paths);
  const removed = (data ?? []).map((row) => row.name).filter((path) => path.length > 0);
  const { clear, pending } = pathsToClear(paths, removed, Boolean(error));
  if (clear.length > 0) {
    const cleared = await supabase.rpc('clear_drawing_orphans', { p_paths: clear });
    if (cleared.error) throw new Error(rpcErrorCode(cleared.error.message));
  }
  if (pending.length > 0) throw new Error('storage_orphan');
}

async function withPhotoUrls(version: VariationVersion): Promise<VariationVersion> {
  const supabase = getSupabase();
  const photos: VariationPhoto[] = await Promise.all(
    (version.photos ?? []).map(async (photo) => {
      const { data, error } = await supabase.storage.from('site-photos').createSignedUrl(photo.storage_path, PHOTO_URL_SECONDS);
      if (error || !data?.signedUrl) return { ...photo, signed_url: null, signed_url_expires_at: null };
      return {
        ...photo,
        signed_url: data.signedUrl,
        signed_url_expires_at: new Date(Date.now() + PHOTO_URL_SECONDS * 1000).toISOString(),
      };
    })
  );
  return { ...version, photos, status: version.status as VariationStatus };
}

// Client list of people. The view has no email or phone. Own contact fields come from my_person().
const PERSON_DIRECTORY_COLUMNS = 'id, auth_user_id, company_id, role, trade, display_name, created_at';

type DirectoryPerson = Omit<Person, 'email' | 'phone'>;

function listedPerson(row: DirectoryPerson): Person {
  return { ...row, email: null, phone: null };
}

type EmbeddedPerson = {
  id: string;
  display_name: string | null;
  role: Role;
  trade: string | null;
  auth_user_id: string | null;
};

type GroupQueryRow = {
  id: string;
  company_id: string;
  name: string;
  created_at: string;
  created_by: string | null;
  people_group_members:
    | Array<{
        person_id: string;
        people: EmbeddedPerson | EmbeddedPerson[] | null;
      }>
    | null;
};

function oneEmbedded(value: EmbeddedPerson | EmbeddedPerson[] | null): EmbeddedPerson | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapGroupRow(row: GroupQueryRow): PeopleGroup {
  const members: PeopleGroupMember[] = (row.people_group_members ?? [])
    .map((member) => {
      const person = oneEmbedded(member.people);
      return {
        person_id: member.person_id,
        display_name: person?.display_name ?? null,
        role: person?.role ?? null,
        trade: person?.trade ?? null,
        has_login: person ? person.auth_user_id != null : null,
      };
    })
    .sort(
      (a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '') || a.person_id.localeCompare(b.person_id)
    );
  return {
    id: row.id,
    company_id: row.company_id,
    name: row.name,
    created_at: row.created_at,
    created_by: row.created_by,
    members,
  };
}

function normalizeContacts(data: unknown): CompanyContact[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const record = row as { id?: unknown; email?: unknown; phone?: unknown };
    if (typeof record.id !== 'string') return [];
    return [
      {
        id: record.id,
        email: typeof record.email === 'string' && record.email.trim() ? record.email : null,
        phone: typeof record.phone === 'string' && record.phone.trim() ? record.phone : null,
      },
    ];
  });
}

async function withCompanyContacts(rows: Person[]): Promise<Person[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('company_contacts');
  if (error) {
    if (rpcErrorCode(error.message) === 'not_authorized') return rows;
    throw new Error(rpcErrorCode(error.message) === 'unknown' ? error.message : rpcErrorCode(error.message));
  }
  const byId = new Map(normalizeContacts(data).map((contact) => [contact.id, contact]));
  return rows.map((person) => {
    const contact = byId.get(person.id);
    if (!contact) return person;
    return { ...person, email: contact.email, phone: contact.phone };
  });
}

async function invokeInvite(body: Record<string, unknown>): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke('invite-person', { body });
  if (error) {
    let bodyError: string | null = null;
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = (await context.json()) as { error?: unknown };
        bodyError = typeof payload.error === 'string' ? payload.error : null;
      } catch {
        bodyError = null;
      }
    }
    throw new Error(inviteFailureMessage(bodyError, 'The invite did not send. Try again.'));
  }
  const payload = data as { error?: unknown } | null;
  if (payload?.error) throw new Error(inviteFailureMessage(String(payload.error), String(payload.error)));
}

async function invokePublicFunction(name: string, body: Record<string, unknown>): Promise<unknown> {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let code = 'join_rejected';
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = (await context.json()) as { error?: unknown };
        if (typeof payload.error === 'string') code = payload.error;
      } catch {
        code = 'join_rejected';
      }
    }
    throw new Error(code);
  }
  if (data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data;
}

async function signUrls(items: Array<ManifestItem & { storage_path?: string }>): Promise<ManifestItem[]> {
  const supabase = getSupabase();
  const paths = items.map((item) => item.storage_path).filter((path): path is string => Boolean(path));
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  if (paths.length === 0) {
    return items.map((item) => ({
      ...item,
      signed_url: item.signed_url,
      signed_url_expires_at: item.signed_url_expires_at ?? expiresAt,
    }));
  }
  const { data, error } = await supabase.storage.from('drawings').createSignedUrls(paths, 3600);
  if (error) throw new Error(error.message);
  const byPath = new Map((data ?? []).map((row) => [row.path, row]));
  return items.map((item) => {
    const signed = item.storage_path ? byPath.get(item.storage_path) : undefined;
    return {
      ...item,
      signed_url: signed?.signedUrl ?? item.signed_url ?? '',
      signed_url_expires_at: expiresAt,
    };
  });
}

function photoExtension(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

function snagStoragePath(params: {
  companyId: string;
  siteId: string;
  contentType: string;
  folder?: 'variations' | 'snags';
  snagId?: string;
}): string {
  if (params.folder === 'snags') {
    if (!params.snagId) throw new Error('invalid_input');
    return `${params.companyId}/${params.siteId}/snags/${params.snagId}/${newId()}.${photoExtension(params.contentType)}`;
  }
  return `${params.companyId}/${params.siteId}/variations/${newId()}`;
}

async function readCompanyLogo(): Promise<{ name: string; logo_path: string | null }> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('companies').select('name, logo_path').limit(1).maybeSingle();
  if (error || !data?.name) throw new Error('not_authorized');
  const path = typeof data.logo_path === 'string' && data.logo_path ? data.logo_path : null;
  return { name: data.name as string, logo_path: path };
}

async function signCompanyMark(name: string, logoPath: string | null): Promise<{ name: string; logoUrl: string | null }> {
  if (!logoPath) return { name, logoUrl: null };
  const { data, error } = await getSupabase().storage.from('company-logos').createSignedUrl(logoPath, PHOTO_URL_SECONDS);
  if (error || !data?.signedUrl) return { name, logoUrl: null };
  return { name, logoUrl: data.signedUrl };
}

export const supabaseRepo: SitePackRepo = {
  async signIn(email, password): Promise<SignInResult> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error || !data.user) {
      throw new Error('Couldn’t sign in. Check email and password and try again.');
    }
    const person = await this.me();
    if (!person) {
      await supabase.auth.signOut();
      throw new Error('Couldn’t sign in. Check email and password and try again.');
    }
    return { person, needsPassword: false };
  },

  async startCompany(input) {
    const parsed = parseStartCompany(input);
    if (!parsed.ok) throw new Error('invalid_input');
    await invokePublicFunction('start-company', {
      company_name: parsed.companyName,
      full_name: parsed.fullName,
      email: parsed.email,
    });
    return { message: CHECK_YOUR_EMAIL };
  },

  async signOut() {
    await getSupabase().auth.signOut();
  },

  async restoreSession() {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data.session) return null;
    return this.me();
  },

  async setPassword(password) {
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) throw new Error(error.message);
  },

  async me() {
    const supabase = getSupabase();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return null;
    const { data, error } = await supabase.rpc('my_person');
    if (error) throw new Error(error.message);
    return (data as Person | null) ?? null;
  },

  async listAssignedSites() {
    const supabase = getSupabase();
    const person = await this.me();
    if (!person) throw new Error('not_authorized');
    const { data: assignments, error } = await supabase
      .from('site_assignments')
      .select('site_id')
      .eq('person_id', person.id);
    if (error) throw new Error(error.message);
    const ids = (assignments ?? []).map((row) => row.site_id as string);
    if (ids.length === 0) return [];
    const { data: sites, error: siteError } = await supabase
      .from('sites')
      .select('*')
      .in('id', ids)
      .order('name');
    if (siteError) throw new Error(siteError.message);
    const { data: requests } = await supabase
      .from('drawing_requests')
      .select('id, site_id, requester_id, status')
      .in('site_id', ids)
      .eq('status', 'Open');
    return ((sites ?? []) as Site[]).map((site) => {
      const open = (requests ?? []).filter((row) => row.site_id === site.id);
      const home: HomeSite = {
        ...site,
        open_request_count: person.role === 'operative' ? undefined : open.length,
        my_open_request_count: open.filter((row) => row.requester_id === person.id).length,
      };
      return home;
    });
  },

  async getSite(siteId) {
    const supabase = getSupabase();
    const person = await this.me();
    if (!person) return null;
    const { data, error } = await supabase.from('sites').select('*').eq('id', siteId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const { data: requests } = await supabase
      .from('drawing_requests')
      .select('id, requester_id, status')
      .eq('site_id', siteId)
      .eq('status', 'Open');
    const open = requests ?? [];
    return {
      ...(data as Site),
      open_request_count: person.role === 'operative' ? undefined : open.length,
      my_open_request_count: open.filter((row) => row.requester_id === person.id).length,
    };
  },

  async listDrawings(siteId) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('drawings')
      .select('*')
      .eq('site_id', siteId)
      .order('title')
      .order('is_current', { ascending: false });
    return unwrap((data ?? []) as Drawing[], error);
  },

  async getDrawing(drawingId) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('drawings').select('*').eq('id', drawingId).maybeSingle();
    return maybe((data as Drawing | null) ?? null, error);
  },

  async sitePackManifest(siteId) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('site_pack_manifest', { p_site_id: siteId });
    if (error) throw new Error(rpcErrorCode(error.message));
    const rows = (data ?? []) as Array<ManifestItem & { storage_path?: string }>;
    return signUrls(rows);
  },

  async createRequest(input: CreateRequestInput) {
    const supabase = getSupabase();
    const person = await this.me();
    if (!person) throw new Error('not_authorized');
    const { data, error } = await supabase
      .from('drawing_requests')
      .insert({
        site_id: input.siteId,
        requester_id: person.id,
        body: input.body,
        sheet_hint: input.sheetHint ?? null,
        photo_path: input.photoPath ?? null,
        status: 'Open',
      })
      .select('*')
      .single();
    return unwrap(data as DrawingRequest, error);
  },

  async listMyRequests() {
    const supabase = getSupabase();
    const person = await this.me();
    if (!person) throw new Error('not_authorized');
    const { data, error } = await supabase
      .from('drawing_requests')
      .select('*')
      .eq('requester_id', person.id)
      .order('created_at', { ascending: false });
    return unwrap((data ?? []) as DrawingRequest[], error);
  },

  async listSiteRequests(siteId) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('drawing_requests')
      .select('*, people!drawing_requests_requester_id_fkey(display_name)')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false });
    if (error) {
      const { data: plain, error: plainError } = await supabase
        .from('drawing_requests')
        .select('*')
        .eq('site_id', siteId)
        .order('created_at', { ascending: false });
      return unwrap((plain ?? []) as DrawingRequest[], plainError);
    }
    return (
      (data ?? []) as Array<DrawingRequest & { people?: { display_name: string | null } | { display_name: string | null }[] }>
    ).map((row) => {
      const person = Array.isArray(row.people) ? row.people[0] : row.people;
      return {
        ...row,
        requester_name: person?.display_name?.trim() || undefined,
      };
    });
  },

  async listInboxRequests() {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('drawing_requests')
      .select('*, sites(name), people!drawing_requests_requester_id_fkey(display_name)')
      .neq('status', 'Closed')
      .order('created_at', { ascending: false });
    if (error) {
      const { data: plain, error: plainError } = await supabase
        .from('drawing_requests')
        .select('*')
        .neq('status', 'Closed')
        .order('created_at', { ascending: false });
      return unwrap((plain ?? []) as DrawingRequest[], plainError);
    }
    return ((data ?? []) as Array<DrawingRequest & { sites?: { name: string }; people?: { display_name: string | null } }>)
      .filter((row) => row.status !== 'Closed')
      .map((row) => ({
        ...row,
        site_name: row.sites?.name,
        requester_name: row.people?.display_name?.trim() || undefined,
      }));
  },

  async getRequest(requestId) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('drawing_requests').select('*').eq('id', requestId).maybeSingle();
    return maybe((data as DrawingRequest | null) ?? null, error);
  },

  async updateRequest(requestId, patch) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('drawing_requests')
      .update({
        status: patch.status,
        cm_note: patch.cm_note,
        fulfilled_drawing_id: patch.fulfilled_drawing_id,
      })
      .eq('id', requestId)
      .select('*')
      .single();
    return unwrap(data as DrawingRequest, error);
  },

  async deleteRequest(requestId) {
    const supabase = getSupabase();
    const { error } = await supabase.from('drawing_requests').delete().eq('id', requestId);
    if (error) throw new Error(rpcErrorCode(error.message));
  },

  async createSite(input) {
    const supabase = getSupabase();
    const person = await this.me();
    if (!person || person.role !== 'owner') throw new Error('not_authorized');
    const fields = normalizeCreateSite(input);
    const id = newId();
    const { error } = await supabase.from('sites').insert({
      id,
      company_id: person.company_id,
      name: fields.name,
      address_line: fields.address_line,
      main_contractor: fields.main_contractor,
      what_it_is: fields.what_it_is,
    });
    if (error) throw new Error(error.message);
    const { data, error: readError } = await supabase.from('sites').select('*').eq('id', id).single();
    return unwrap(data as Site, readError);
  },

  async archiveSite(siteId, archived) {
    const supabase = getSupabase();
    const { error } = await supabase.rpc(archived ? 'archive_site' : 'restore_site', { p_site_id: siteId });
    if (error) throw new Error(rpcErrorCode(error.message));
  },

  async deleteDrawing(drawingId) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('delete_drawing', { p_drawing_id: drawingId });
    if (error) throw new Error(rpcErrorCode(error.message));
    const paths = (Array.isArray(data) ? data : []).filter(
      (path): path is string => typeof path === 'string' && path.length > 0,
    );
    await removeDrawingObjects(paths);
    return paths;
  },

  async sweepDrawingOrphans() {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('list_drawing_orphans');
    if (error || !Array.isArray(data)) return;
    const paths = data.filter((path): path is string => typeof path === 'string' && path.length > 0);
    if (paths.length === 0) return;
    try {
      await removeDrawingObjects(paths);
    } catch {
      return;
    }
  },

  async companySitesPulse() {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('company_sites_pulse');
    if (error) throw new Error(rpcErrorCode(error.message));
    return (data ?? []) as PulseRow[];
  },

  async contractsManagerNames(siteId) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('site_contracts_manager_names', { p_site_id: siteId });
    if (error) throw new Error(rpcErrorCode(error.message));
    return Array.isArray(data) ? data.filter((name): name is string => typeof name === 'string') : [];
  },

  async listAssignments(siteId) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('site_assignments')
      .select(`id, site_id, person_id, created_at, people(${PERSON_DIRECTORY_COLUMNS})`)
      .eq('site_id', siteId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => {
      const embedded = Array.isArray(row.people) ? row.people[0] : row.people;
      return {
        id: row.id,
        site_id: row.site_id,
        person_id: row.person_id,
        created_at: row.created_at,
        person: embedded ? listedPerson(embedded) : undefined,
      };
    });
  },

  async addAssignment(siteId, personId) {
    const supabase = getSupabase();
    const { error } = await supabase.from('site_assignments').insert({ site_id: siteId, person_id: personId });
    if (error) throw new Error(error.message);
  },

  async removeAssignment(assignmentId) {
    const supabase = getSupabase();
    const { error } = await supabase.from('site_assignments').delete().eq('id', assignmentId);
    if (error) throw new Error(error.message);
  },

  async listCompanyPeople() {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('people_directory')
      .select(PERSON_DIRECTORY_COLUMNS)
      .order('display_name');
    return withCompanyContacts(unwrap((data ?? []) as DirectoryPerson[], error).map(listedPerson));
  },

  async companyContacts() {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('company_contacts');
    if (error) throw new Error(rpcErrorCode(error.message) === 'unknown' ? error.message : rpcErrorCode(error.message));
    return normalizeContacts(data);
  },

  async companyPeople() {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('company_people');
    if (error) throw new Error(rpcErrorCode(error.message));
    return (data ?? []) as CompanyPerson[];
  },

  async addNoLoginOperative(input: AddNoLoginOperativeInput) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('add_no_login_operative', {
      p_display_name: input.displayName,
      p_trade: input.trade ?? null,
      p_site_ids: input.siteIds,
    });
    if (error) throw new Error(rpcErrorCode(error.message));
    return data as string;
  },

  async removeOperativeFromSite(personId, siteId) {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('remove_operative_from_site', {
      p_person_id: personId,
      p_site_id: siteId,
    });
    if (error) throw new Error(rpcErrorCode(error.message));
  },

  async uploadDrawingFile({ companyId, siteId, drawingId, bytes, contentType, fileName }) {
    const supabase = getSupabase();
    const storagePath = `${companyId}/${siteId}/${drawingId}.pdf`;
    const content = contentType || 'application/pdf';
    const { error } = await uploadBytes(
      (path, body, options) => supabase.storage.from('drawings').upload(path, body, options),
      storagePath,
      bytes,
      { contentType: content, upsert: true, os: Platform.OS }
    );
    if (error) throw new Error(error.message);
    void fileName;
    return { storagePath, fileSizeBytes: bytes.byteLength };
  },

  async replaceDrawing(input: ReplaceDrawingInput) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('replace_drawing', {
      p_site_id: input.siteId,
      p_title: input.title,
      p_revision: input.revision,
      p_storage_path: input.storagePath,
      p_sheet_number: input.sheetNumber ?? null,
      p_dated: input.dated ?? null,
      p_file_size_bytes: input.fileSizeBytes ?? null,
      p_content_type: input.contentType ?? 'application/pdf',
      p_replace_drawing_id: input.replaceDrawingId ?? null,
      p_id: input.id ?? null,
      p_folder: input.folder ?? null,
      p_level: input.level ?? null,
    });
    if (error) throw new Error(rpcErrorCode(error));
    return data as Drawing;
  },

  async invitePerson(input: InviteInput) {
    await invokeInvite({
      email: input.email,
      display_name: input.displayName,
      role: input.role,
      trade: input.trade ?? null,
      site_ids: inviteSiteIds(input),
    });
  },

  async attachLogin(personId, email) {
    await invokeInvite({ person_id: personId, email });
  },

  async listPeopleGroups() {
    const person = await this.me();
    if (!person || (person.role !== 'owner' && person.role !== 'cm')) throw new Error('not_authorized');
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('people_groups')
      .select(
        'id, company_id, name, created_at, created_by, people_group_members(person_id, people(id, display_name, role, trade, auth_user_id))'
      )
      .order('name');
    if (error) throw new Error(rpcErrorCode(error));
    return ((data ?? []) as GroupQueryRow[]).map(mapGroupRow);
  },

  async createPeopleGroup(name) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('create_people_group', { p_name: name });
    if (error) throw new Error(rpcErrorCode(error));
    if (typeof data !== 'string') throw new Error('not_authorized');
    return data;
  },

  async renamePeopleGroup(groupId, name) {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('rename_people_group', { p_group_id: groupId, p_name: name });
    if (error) throw new Error(rpcErrorCode(error));
  },

  async deletePeopleGroup(groupId) {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('delete_people_group', { p_group_id: groupId });
    if (error) throw new Error(rpcErrorCode(error));
  },

  async setPeopleGroupMembers(groupId, personIds) {
    const supabase = getSupabase();
    const { error } = await supabase.rpc('set_people_group_members', {
      p_group_id: groupId,
      p_person_ids: personIds,
    });
    if (error) throw new Error(rpcErrorCode(error));
  },

  async assignGroupToSites(groupId, siteIds) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('assign_group_to_sites', {
      p_group_id: groupId,
      p_site_ids: siteIds,
    });
    if (error) throw new Error(rpcErrorCode(error));
    return { added: groupCount(data, 'added') };
  },

  async removeGroupFromSite(groupId, siteId) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('remove_group_from_site', {
      p_group_id: groupId,
      p_site_id: siteId,
    });
    if (error) throw new Error(rpcErrorCode(error));
    return { removed: groupCount(data, 'removed') };
  },

  async signInWithUsername(username, password) {
    const data = (await invokePublicFunction('login-with-username', { username, password })) as {
      access_token?: string;
      refresh_token?: string;
    };
    if (!data.access_token || !data.refresh_token) throw new Error('sign_in_failed');
    const { error } = await getSupabase().auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (error) throw new Error('sign_in_failed');
    const person = await this.me();
    if (!person) {
      await getSupabase().auth.signOut();
      throw new Error('sign_in_failed');
    }
    return { person, needsPassword: false };
  },

  async companyName() {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('companies').select('name').limit(1).maybeSingle();
    if (error || !data?.name) throw new Error('not_authorized');
    return data.name as string;
  },

  async companyMark() {
    const row = await readCompanyLogo();
    return signCompanyMark(row.name, row.logo_path);
  },

  async setCompanyLogo(photo) {
    const person = await this.me();
    if (!person || person.role !== 'owner') throw new Error('not_authorized');
    const current = await readCompanyLogo();
    const supabase = getSupabase();
    if (!photo) {
      const { error } = await supabase.from('companies').update({ logo_path: null }).eq('id', person.company_id);
      if (error) throw new Error(rpcErrorCode(error));
      if (current.logo_path) {
        const removed = await supabase.storage.from('company-logos').remove([current.logo_path]);
        if (removed.error) throw new Error('invalid_input');
      }
      return { name: current.name, logoUrl: null };
    }
    const extension = assertLogoUpload(photo.bytes, photo.contentType);
    const path = logoObjectPath(person.company_id, newId(), extension);
    const uploaded = await uploadBytes(
      (objectPath, body, options) => supabase.storage.from('company-logos').upload(objectPath, body, options),
      path,
      photo.bytes,
      { contentType: photo.contentType, upsert: false, os: Platform.OS }
    );
    if (uploaded.error) throw new Error('invalid_input');
    const { error } = await supabase.from('companies').update({ logo_path: path }).eq('id', person.company_id);
    if (error) {
      await supabase.storage.from('company-logos').remove([path]);
      throw new Error(rpcErrorCode(error));
    }
    if (current.logo_path && current.logo_path !== path) {
      const removed = await supabase.storage.from('company-logos').remove([current.logo_path]);
      if (removed.error) throw new Error('invalid_input');
    }
    return signCompanyMark(current.name, path);
  },

  async createJoinCode(input) {
    const data = (await invokePublicFunction('issue-join-code', {
      site_id: input.siteId,
      label: input.label ?? null,
      max_uses: input.maxUses ?? 10,
      hours: input.hours ?? 24,
    })) as JoinCodeCreated;
    return data;
  },

  async listJoinCodes(siteId) {
    const supabase = getSupabase();
    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('archived_at')
      .eq('id', siteId)
      .maybeSingle();
    if (siteError) throw new Error(rpcErrorCode(siteError));
    if (site?.archived_at) return [];
    const { data, error } = await supabase
      .from('join_codes')
      .select('id, site_id, label, expires_at, max_uses, uses, revoked_at, created_at')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(rpcErrorCode(error));
    return (data ?? []) as JoinCodeRow[];
  },

  async revokeJoinCode(codeId) {
    const { error } = await getSupabase().rpc('revoke_join_code', { p_code_id: codeId });
    if (error) throw new Error(rpcErrorCode(error));
  },

  async listJoiners(siteId) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('join_events')
      .select('id, person_id, display_name, trade, username, joined_at, removed_at, code_id, join_codes(label)')
      .eq('site_id', siteId)
      .order('joined_at', { ascending: false });
    if (error) throw new Error(rpcErrorCode(error));
    return ((data ?? []) as Array<JoinerRow & { join_codes?: { label: string | null } | { label: string | null }[] | null }>).map(
      (row) => {
        const linked = Array.isArray(row.join_codes) ? row.join_codes[0] : row.join_codes;
        return {
          id: row.id,
          person_id: row.person_id,
          display_name: row.display_name,
          trade: row.trade,
          username: row.username,
          joined_at: row.joined_at,
          removed_at: row.removed_at,
          code_id: row.code_id,
          code_label: linked?.label ?? null,
        };
      }
    );
  },

  async joinWithCode(input: JoinWithCodeInput) {
    const data = (await invokePublicFunction('join-with-code', {
      code: input.code,
      display_name: input.displayName,
      trade: input.trade,
      username: input.username,
      password: input.password,
    })) as { access_token?: string; refresh_token?: string; site_id?: string };
    if (!data.access_token || !data.refresh_token || !data.site_id) throw new Error('join_rejected');
    const { error } = await getSupabase().auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (error) throw new Error('join_rejected');
    const person = await this.me();
    if (!person) throw new Error('join_rejected');
    return { person, siteId: data.site_id };
  },

  async removeJoiner(personId, siteId, revokeCode) {
    const { error } = await getSupabase().rpc('remove_joiner', {
      p_person_id: personId,
      p_site_id: siteId,
      p_revoke_code: revokeCode,
    });
    if (error) throw new Error(rpcErrorCode(error));
  },

  async issuePasswordReset(personId) {
    const data = (await invokePublicFunction('issue-reset-code', { person_id: personId })) as PasswordResetIssued;
    return data;
  },

  async redeemPasswordReset(code, password) {
    await invokePublicFunction('redeem-reset-code', { code, password });
  },

  async acknowledgePasswordReset() {
    const { error } = await getSupabase().rpc('acknowledge_password_reset');
    if (error) throw new Error(rpcErrorCode(error));
  },

  async listVariations(siteId) {
    const data = unwrap(await rpcJson('list_variations', { p_site_id: siteId }), null) as VariationList;
    return data;
  },

  async getVariation(variationId) {
    try {
      const data = unwrap(await rpcJson('variation_detail', { p_variation_id: variationId }), null) as VariationDetail;
      data.current = await withPhotoUrls(data.current);
      data.history = await Promise.all(data.history.map((version) => withPhotoUrls(version)));
      return data;
    } catch (err) {
      if (err instanceof Error && err.message === 'not_authorized') return null;
      throw err;
    }
  },

  async createVariation(input: CreateVariationInput) {
    const data = unwrap(
      await rpcJson('create_variation', {
        p_site_id: input.siteId,
        p_title: input.title,
        p_description: input.description,
        p_level_area: input.levelArea ?? null,
        p_quantity_text: input.quantityText ?? null,
        p_value_pence: input.valuePence ?? null,
        p_photos: input.photos.map((photo) => ({
          storage_path: photo.storagePath,
          content_type: photo.contentType,
          file_size_bytes: photo.fileSizeBytes,
        })),
      }),
      null
    ) as { variation_id: string; version_id: string; vo_seq: number };
    return { variationId: data.variation_id, versionId: data.version_id, voSeq: data.vo_seq };
  },

  async updateVariationDraft(versionId, input) {
    unwrap(
      await rpcJson('update_variation_draft', {
        p_version_id: versionId,
        p_title: input.title,
        p_description: input.description,
        p_level_area: input.levelArea ?? null,
        p_quantity_text: input.quantityText ?? null,
        p_photos: input.photos.map((photo) => ({
          storage_path: photo.storagePath,
          content_type: photo.contentType,
          file_size_bytes: photo.fileSizeBytes,
        })),
      }),
      null
    );
  },

  async setVariationValue(versionId, valuePence) {
    unwrap(await rpcJson('set_variation_value', { p_version_id: versionId, p_value_pence: valuePence }), null);
  },

  async signVariation(versionId, input) {
    unwrap(
      await rpcJson('sign_variation', {
        p_version_id: versionId,
        p_signer_name: input.signerName,
        p_role: input.role,
        p_company: input.company,
        p_signature_png: input.signaturePng,
        p_expected_pence: input.expectedPence,
      }),
      null
    );
  },

  async sendVariation(versionId) {
    unwrap(await rpcJson('send_variation', { p_version_id: versionId }), null);
  },

  async reviseVariation(versionId) {
    const data = unwrap(await rpcJson('revise_variation', { p_version_id: versionId }), null) as { version_id: string };
    return { versionId: data.version_id };
  },

  async uploadSitePhoto(params) {
    const supabase = getSupabase();
    const storagePath = snagStoragePath(params);
    const { error } = await uploadBytes(
      (path, body, options) => supabase.storage.from('site-photos').upload(path, body, options),
      storagePath,
      params.bytes,
      { contentType: params.contentType, upsert: false, os: Platform.OS }
    );
    if (error) throw snagStorageError(error);
    return { storagePath, fileSizeBytes: params.bytes.byteLength, contentType: params.contentType };
  },

  async signSitePhotoUrl(storagePath) {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage.from('site-photos').createSignedUrl(storagePath, PHOTO_URL_SECONDS);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not sign photo URL');
    return { url: data.signedUrl, expiresAt: new Date(Date.now() + PHOTO_URL_SECONDS * 1000).toISOString() };
  },

  async getDrawingOpenUrl(drawing) {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage.from('drawings').createSignedUrl(drawing.storage_path, 3600);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not sign drawing URL');
    return data.signedUrl;
  },

  async listMyUnseenDrawings() {
    return parseUnseenDrawings(await rpcJson('my_unseen_drawings', {}));
  },

  async myDrawingProof(drawingId) {
    return parseDrawingProof(await rpcJson('my_drawing_proof', { p_drawing_id: drawingId }));
  },

  async siteDrawingSeen(siteId) {
    return parseSiteSeenSummary(await rpcJson('site_drawing_seen', { p_site_id: siteId }));
  },

  async siteNotSeen(siteId) {
    return parseNotSeenPeople(await rpcJson('site_not_seen', { p_site_id: siteId }));
  },

  async drawingSeenRoster(drawingId) {
    return parseDrawingRoster(await rpcJson('drawing_seen_roster', { p_drawing_id: drawingId }));
  },

  async managerDrawingGaps() {
    return parseSiteSeenGaps(await rpcJson('manager_drawing_gaps', {}));
  },

  async recordDrawingOpen(drawingId) {
    await rpcJson('record_drawing_open', { p_drawing_id: drawingId });
  },

  async confirmDrawingSeen(drawingId, seenAt) {
    return {
      seenAt: parseSeenAt(
        await rpcJson('confirm_drawing_seen', { p_drawing_id: drawingId, p_seen_at: seenAt ?? null })
      ),
    };
  },

  async listSnags(siteId) {
    return unwrap(await rpcJson('list_snags', { p_site_id: siteId }), null) as SnagList;
  },

  async snagReport(siteId) {
    const data = unwrap(await rpcJson('snag_report', { p_site_id: siteId }), null) as SnagReport;
    data.rows = await Promise.all(data.rows.map((row) => withSnagPhotoUrls(row)));
    return data;
  },

  async getSnag(snagId) {
    try {
      const data = unwrap(await rpcJson('snag_detail', { p_snag_id: snagId }), null) as SnagDetail;
      return withSnagPhotoUrls(data);
    } catch (err) {
      if (err instanceof Error && err.message === 'not_authorized') return null;
      throw err;
    }
  },

  async createSnag(input: CreateSnagInput) {
    const data = unwrap(
      await rpcJson('create_snag', {
        p_id: input.snagId,
        p_site_id: input.siteId,
        p_note: input.note,
        p_level_area: input.levelArea ?? null,
        p_trade_label: input.tradeLabel,
        p_raised_at: input.raisedAt,
        p_photos: input.photos.map(photoPayload),
      }),
      null
    ) as { snag_id: string; snag_seq: number; already_existed?: boolean; photo_paths?: string[] };
    return {
      snagId: data.snag_id,
      snagSeq: data.snag_seq,
      alreadyExisted: data.already_existed === true,
      photoPaths: Array.isArray(data.photo_paths) ? data.photo_paths : [],
    };
  },

  async fixSnag(snagId, fixedAt, photos, fixId) {
    const data = unwrap(
      await rpcJson('fix_snag', {
        p_snag_id: snagId,
        p_fixed_at: fixedAt,
        p_photos: photos.map(photoPayload),
        p_fix_id: fixId ?? null,
      }),
      null
    ) as { already_fixed?: boolean };
    return { alreadyFixed: data.already_fixed === true };
  },

  async removeSitePhotos(storagePaths) {
    const paths = storagePaths.filter((path) => path.length > 0);
    if (paths.length < 1) return;
    const { error } = await getSupabase().storage.from('site-photos').remove(paths);
    if (error) throw new Error(rpcErrorCode(error));
  },

  async signOffSnagsInternal(input: SignOffSnagsInput) {
    return unwrap(
      await rpcJson('sign_off_snags_internal', {
        p_signoff_id: input.signoffId,
        p_site_id: input.siteId,
        p_signed_at: input.signedAt,
        p_company: input.company,
        p_covered_ids: input.coveredIds,
        p_outstanding_ids: input.outstandingIds,
      }),
      null
    ) as SnagSignoff;
  },

  async signOffSnagsContractor(input: SignOffSnagsInput) {
    return unwrap(
      await rpcJson('sign_off_snags_contractor', {
        p_signoff_id: input.signoffId,
        p_site_id: input.siteId,
        p_signed_at: input.signedAt,
        p_signer_name: input.signerName ?? '',
        p_signer_role: input.signerRole ?? '',
        p_company: input.company,
        p_signature_png: input.signaturePng ?? '',
        p_covered_ids: input.coveredIds,
        p_outstanding_ids: input.outstandingIds,
      }),
      null
    ) as SnagSignoff;
  },

  async snagTradeLabels(siteId) {
    const data = unwrap(await rpcJson('snag_trade_labels', { p_site_id: siteId }), null);
    return Array.isArray(data) ? data.filter((item): item is string => typeof item === 'string') : [];
  },

  async listSiteDocuments(siteId) {
    const person = await this.me();
    if (!person) throw new Error('not_authorized');
    const supabase = getSupabase();
    const documents = await documentRows(
      supabase.from('site_documents').select('id, site_id, kind, title, archived_at').eq('site_id', siteId).order('title'),
    );
    const versions = await documentRows(
      supabase
        .from('site_document_versions')
        .select('id, document_id, version_no, storage_path')
        .eq('site_id', siteId)
        .eq('is_current', true),
    );
    const versionIds = versions.map((row) => String(row.id));
    const signatures =
      versionIds.length === 0
        ? []
        : await documentRows(
            supabase.from('site_document_signatures').select('version_id, person_id').in('version_id', versionIds),
          );
    return documents.flatMap((row) => {
      const version = versions.find((item) => item.document_id === row.id);
      if (!version || !isSiteDocumentKind(String(row.kind))) return [];
      return [
        {
          id: String(row.id),
          site_id: String(row.site_id),
          kind: String(row.kind) as SiteDocumentKind,
          title: String(row.title),
          version_id: String(version.id),
          version_no: Number(version.version_no),
          storage_path: String(version.storage_path),
          signed_by_me: signatures.some(
            (signature) => signature.version_id === version.id && signature.person_id === person.id,
          ),
          archived_at: row.archived_at == null ? null : String(row.archived_at),
        } satisfies SiteDocumentSummary,
      ];
    });
  },

  async getSiteDocument(documentId) {
    const person = await this.me();
    if (!person) throw new Error('not_authorized');
    const supabase = getSupabase();
    const { data: document, error } = await supabase
      .from('site_documents')
      .select('id, site_id, kind, title, archived_at')
      .eq('id', documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!document || !isSiteDocumentKind(String(document.kind))) return null;
    const { data: version, error: versionError } = await supabase
      .from('site_document_versions')
      .select('id, version_no, storage_path')
      .eq('document_id', documentId)
      .eq('is_current', true)
      .maybeSingle();
    if (versionError) throw new Error(versionError.message);
    if (!version) return null;
    const signatures = await documentRows(
      supabase
        .from('site_document_signatures')
        .select('person_id, signed_at')
        .eq('version_id', version.id),
    );
    const detail: SiteDocumentDetail = {
      id: String(document.id),
      site_id: String(document.site_id),
      kind: document.kind as SiteDocumentKind,
      title: String(document.title),
      version_id: String(version.id),
      version_no: Number(version.version_no),
      storage_path: String(version.storage_path),
      signed_by_me: signatures.some((row) => row.person_id === person.id),
      archived_at: document.archived_at == null ? null : String(document.archived_at),
      signatures: signatures.map(
        (row): SiteDocumentSignature => ({
          person_id: String(row.person_id),
          signed_at: String(row.signed_at),
        }),
      ),
    };
    return detail;
  },

  async createSiteDocument(input: CreateSiteDocumentInput) {
    const bytesError = siteDocumentBytesError(input.bytes);
    if (bytesError) throw new Error(bytesError);
    const supabase = getSupabase();
    const documentId = newId();
    const versionId = newId();
    const storagePath = siteDocumentPath(input.companyId, input.siteId, documentId, versionId);
    const { error: uploadError } = await uploadBytes(
      (path, body, options) => supabase.storage.from('site-documents').upload(path, body, options),
      storagePath,
      input.bytes,
      { contentType: 'application/pdf', upsert: false, os: Platform.OS },
    );
    if (uploadError) throw new Error(uploadError.message);
    const { error: documentError } = await supabase.from('site_documents').insert({
      id: documentId,
      site_id: input.siteId,
      company_id: input.companyId,
      kind: input.kind,
      title: input.title.trim(),
      created_by: input.createdBy,
    });
    if (documentError) {
      await supabase.storage.from('site-documents').remove([storagePath]);
      throw new Error(documentError.message);
    }
    const { error: versionError } = await supabase.from('site_document_versions').insert({
      id: versionId,
      document_id: documentId,
      site_id: input.siteId,
      company_id: input.companyId,
      storage_path: storagePath,
      file_name: input.fileName.trim() || 'document.pdf',
      is_current: true,
      created_by: input.createdBy,
      version_no: 1,
    });
    if (versionError) {
      await supabase.from('site_documents').delete().eq('id', documentId);
      await supabase.storage.from('site-documents').remove([storagePath]);
      throw new Error(versionError.message);
    }
    return { id: documentId };
  },

  async replaceSiteDocument(input: ReplaceSiteDocumentInput) {
    const bytesError = siteDocumentBytesError(input.bytes);
    if (bytesError) throw new Error(bytesError);
    const supabase = getSupabase();
    const { data: document, error } = await supabase
      .from('site_documents')
      .select('id, site_id, company_id')
      .eq('id', input.documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!document) throw new Error('not_authorized');
    const versionId = newId();
    const storagePath = siteDocumentPath(
      String(document.company_id),
      String(document.site_id),
      String(document.id),
      versionId,
    );
    const { error: uploadError } = await uploadBytes(
      (path, body, options) => supabase.storage.from('site-documents').upload(path, body, options),
      storagePath,
      input.bytes,
      { contentType: 'application/pdf', upsert: false, os: Platform.OS },
    );
    if (uploadError) throw new Error(uploadError.message);
    const { error: versionError } = await supabase.from('site_document_versions').insert({
      id: versionId,
      document_id: document.id,
      site_id: document.site_id,
      company_id: document.company_id,
      storage_path: storagePath,
      file_name: input.fileName.trim() || 'document.pdf',
      is_current: true,
      created_by: input.createdBy,
      version_no: 1,
    });
    if (versionError) {
      await supabase.storage.from('site-documents').remove([storagePath]);
      throw new Error(versionError.message);
    }
  },

  async deleteSiteDocument(documentId) {
    const supabase = getSupabase();
    const versions = await documentRows(
      supabase.from('site_document_versions').select('storage_path').eq('document_id', documentId),
    );
    const paths = versions.map((row) => String(row.storage_path)).filter((path) => path.length > 0);
    const { data: removedRows, error } = await supabase.from('site_documents').delete().eq('id', documentId).select('id');
    if (error) throw new Error(error.message);
    if (!removedRows || removedRows.length === 0) {
      throw new Error('This document has been signed. Archive it instead.');
    }
    if (paths.length === 0) return;
    const removed = await supabase.storage.from('site-documents').remove(paths);
    if (removed.error) throw new Error(removed.error.message);
  },

  async archiveSiteDocument(documentId) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('site_documents')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', documentId)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('Could not archive the document.');
  },

  async signSiteDocument(input: SignSiteDocumentInput) {
    const supabase = getSupabase();
    const { error } = await supabase.from('site_document_signatures').insert({
      version_id: input.versionId,
      document_id: input.documentId,
      site_id: input.siteId,
      person_id: input.personId,
    });
    if (error) throw new Error(error.message);
  },

  async siteDocumentUrl(storagePath) {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage.from('site-documents').createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not open the PDF');
    return data.signedUrl;
  },
};

function photoPayload(photo: { storagePath: string; contentType: string; fileSizeBytes: number }) {
  return {
    storage_path: photo.storagePath,
    content_type: photo.contentType,
    file_size_bytes: photo.fileSizeBytes,
  };
}

async function withSnagPhotoUrls(detail: SnagDetail): Promise<SnagDetail> {
  const supabase = getSupabase();
  const photos: SnagPhoto[] = await Promise.all(
    (detail.photos ?? []).map(async (photo) => {
      const { data, error } = await supabase.storage.from('site-photos').createSignedUrl(photo.storage_path, PHOTO_URL_SECONDS);
      if (error || !data?.signedUrl) return { ...photo, signed_url: null, signed_url_expires_at: null };
      return {
        ...photo,
        signed_url: data.signedUrl,
        signed_url_expires_at: new Date(Date.now() + PHOTO_URL_SECONDS * 1000).toISOString(),
      };
    })
  );
  return { ...detail, photos, status: detail.status as SnagStatus };
}
