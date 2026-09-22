import { normalizeCreateSite } from '@/data/createSite';
import { inviteFailureMessage } from '@/data/inviteError';
import type { SitePackRepo, SignInResult } from '@/data/repo';
import { rpcErrorCode } from '@/data/repo';
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
  Site,
} from '@/data/types';
import { getSupabase } from '@/lib/supabase';

function unwrap<T>(data: T | null, error: { message: string } | null, fallback?: string): T {
  if (error) throw new Error(rpcErrorCode(error.message) === 'unknown' ? error.message : rpcErrorCode(error.message));
  if (data == null) throw new Error(fallback ?? 'not_found');
  return data;
}

function maybe<T>(data: T | null, error: { message: string } | null): T | null {
  if (error) throw new Error(error.message);
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
    const { data, error } = await supabase.from('people').select('*').eq('id', userData.user.id).maybeSingle();
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

  async listInboxRequests() {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('drawing_requests')
      .select('*, sites(name), people!drawing_requests_requester_id_fkey(display_name, email)')
      .order('created_at', { ascending: false });
    if (error) {
      const { data: plain, error: plainError } = await supabase
        .from('drawing_requests')
        .select('*')
        .order('created_at', { ascending: false });
      return unwrap((plain ?? []) as DrawingRequest[], plainError);
    }
    return ((data ?? []) as Array<DrawingRequest & { sites?: { name: string }; people?: { display_name: string | null; email: string | null } }>).map(
      (row) => ({
        ...row,
        site_name: row.sites?.name,
        requester_name: row.people?.display_name ?? row.people?.email ?? undefined,
      })
    );
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

  async createSite(input) {
    const supabase = getSupabase();
    const person = await this.me();
    if (!person || person.role !== 'owner') throw new Error('not_authorized');
    const fields = normalizeCreateSite(input);
    const id = crypto.randomUUID();
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

  async companySitesPulse() {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('company_sites_pulse');
    if (error) throw new Error(rpcErrorCode(error.message));
    return (data ?? []) as PulseRow[];
  },

  async listAssignments(siteId) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('site_assignments')
      .select('*, people(*)')
      .eq('site_id', siteId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      site_id: row.site_id,
      person_id: row.person_id,
      created_at: row.created_at,
      person: row.people as Person,
    }));
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
    const { data, error } = await supabase.from('people').select('*').order('display_name');
    return unwrap((data ?? []) as Person[], error);
  },

  async uploadDrawingFile({ companyId, siteId, drawingId, bytes, contentType, fileName }) {
    const supabase = getSupabase();
    const storagePath = `${companyId}/${siteId}/${drawingId}.pdf`;
    const body = new Blob([bytes.buffer as ArrayBuffer], { type: contentType || 'application/pdf' });
    const { error } = await supabase.storage.from('drawings').upload(storagePath, body, {
      contentType: contentType || 'application/pdf',
      upsert: true,
    });
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
    });
    if (error) throw new Error(rpcErrorCode(error.message));
    return data as Drawing;
  },

  async invitePerson(input: InviteInput) {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('invite-person', {
      body: {
        email: input.email,
        display_name: input.displayName,
        role: input.role,
        trade: input.trade ?? null,
        site_id: input.siteId ?? null,
      },
    });
    if (error) {
      let bodyError: string | null = null;
      const context = (error as { context?: unknown }).context;
      if (context instanceof Response) {
        try {
          const body = (await context.json()) as { error?: unknown };
          bodyError = typeof body.error === 'string' ? body.error : null;
        } catch {
          bodyError = null;
        }
      }
      throw new Error(inviteFailureMessage(bodyError, error.message));
    }
    if (data?.error) throw new Error(inviteFailureMessage(String(data.error), String(data.error)));
  },

  async getDrawingOpenUrl(drawing) {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage.from('drawings').createSignedUrl(drawing.storage_path, 3600);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not sign drawing URL');
    return data.signedUrl;
  },
};
