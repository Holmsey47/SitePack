import type { CreateSiteInput } from '@/data/createSite';
import type {
  CreateRequestInput,
  Drawing,
  DrawingRequest,
  AddNoLoginOperativeInput,
  CompanyPerson,
  HomeSite,
  InviteInput,
  ManifestItem,
  Person,
  PulseRow,
  ReplaceDrawingInput,
  RequestStatus,
  Role,
  Site,
  SiteAssignment,
} from '@/data/types';

export type SignInResult = {
  person: Person;
  needsPassword: boolean;
};

export type SitePackRepo = {
  signIn(email: string, password: string): Promise<SignInResult>;
  signOut(): Promise<void>;
  restoreSession(): Promise<Person | null>;
  setPassword(password: string): Promise<void>;
  me(): Promise<Person | null>;
  listAssignedSites(): Promise<HomeSite[]>;
  getSite(siteId: string): Promise<HomeSite | null>;
  listDrawings(siteId: string): Promise<Drawing[]>;
  getDrawing(drawingId: string): Promise<Drawing | null>;
  sitePackManifest(siteId: string): Promise<ManifestItem[]>;
  createRequest(input: CreateRequestInput): Promise<DrawingRequest>;
  listMyRequests(): Promise<DrawingRequest[]>;
  listInboxRequests(): Promise<DrawingRequest[]>;
  getRequest(requestId: string): Promise<DrawingRequest | null>;
  updateRequest(
    requestId: string,
    patch: { status: RequestStatus; cm_note?: string | null; fulfilled_drawing_id?: string | null }
  ): Promise<DrawingRequest>;
  companySitesPulse(): Promise<PulseRow[]>;
  createSite(input: CreateSiteInput): Promise<Site>;
  listAssignments(siteId: string): Promise<SiteAssignment[]>;
  addAssignment(siteId: string, personId: string): Promise<void>;
  removeAssignment(assignmentId: string): Promise<void>;
  listCompanyPeople(): Promise<Person[]>;
  companyPeople(): Promise<CompanyPerson[]>;
  addNoLoginOperative(input: AddNoLoginOperativeInput): Promise<string>;
  removeOperativeFromSite(personId: string, siteId: string): Promise<void>;
  uploadDrawingFile(params: {
    companyId: string;
    siteId: string;
    drawingId: string;
    bytes: Uint8Array;
    contentType: string;
    fileName: string;
  }): Promise<{ storagePath: string; fileSizeBytes: number }>;
  replaceDrawing(input: ReplaceDrawingInput): Promise<Drawing>;
  invitePerson(input: InviteInput): Promise<void>;
  attachLogin(personId: string, email: string): Promise<void>;
  getDrawingOpenUrl(drawing: Drawing): Promise<string>;
};

export function canManageSite(role: Role): boolean {
  return role === 'cm' || role === 'owner';
}

export function rpcErrorCode(message: string | undefined): string {
  const text = message ?? '';
  for (const code of [
    'not_authorized',
    'site_not_found',
    'replace_target_not_current',
    'storage_path_required',
    'name_required',
    'email_required',
    'email_in_use',
    'already_has_login',
  ]) {
    if (text.includes(code)) return code;
  }
  return 'unknown';
}
