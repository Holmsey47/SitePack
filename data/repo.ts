import type { CreateSiteInput } from '@/data/createSite';
import type { CompanyMark } from '@/data/companyLogo';
import type { StartCompanyInput } from '@/data/startCompany';
import type {
  CreateRequestInput,
  Drawing,
  DrawingRequest,
  AddNoLoginOperativeInput,
  CompanyContact,
  CompanyPerson,
  HomeSite,
  PeopleGroup,
  InviteInput,
  JoinCodeCreated,
  JoinCodeRow,
  JoinWithCodeInput,
  JoinerRow,
  ManifestItem,
  PasswordResetIssued,
  Person,
  PulseRow,
  ReplaceDrawingInput,
  RequestStatus,
  Role,
  Site,
  SiteAssignment,
} from '@/data/types';
import type {
  DrawingProof,
  DrawingRoster,
  NotSeenPerson,
  SiteSeenGap,
  SiteSeenSummary,
  UnseenDrawing,
} from '@/data/drawingSeen';
import type { CreateVariationInput, VariationDetail, VariationList, VariationPhotoInput } from '@/data/variations';
import type { CreateSnagInput, CreateSnagResult, SignOffSnagsInput, SnagDetail, SnagList, SnagPhotoInput, SnagReport, SnagSignoff } from '@/data/snags';
import type {
  CreateSiteDocumentInput,
  ReplaceSiteDocumentInput,
  SignSiteDocumentInput,
  SiteDocumentDetail,
  SiteDocumentSummary,
} from '@/data/siteDocuments';
import type { UnsignedSignDocument } from '@/data/signNudge';

export type SignInResult = {
  person: Person;
  needsPassword: boolean;
};

export type SitePackRepo = {
  signIn(email: string, password: string): Promise<SignInResult>;
  startCompany(input: StartCompanyInput): Promise<{ message: string }>;
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
  /** Requests on this site that the caller can already select. */
  listSiteRequests(siteId: string): Promise<DrawingRequest[]>;
  getRequest(requestId: string): Promise<DrawingRequest | null>;
  updateRequest(
    requestId: string,
    patch: { status: RequestStatus; cm_note?: string | null; fulfilled_drawing_id?: string | null }
  ): Promise<DrawingRequest>;
  deleteRequest(requestId: string): Promise<void>;
  companySitesPulse(): Promise<PulseRow[]>;
  createSite(input: CreateSiteInput): Promise<Site>;
  archiveSite(siteId: string, archived: boolean): Promise<void>;
  /** Owner only. Removes every revision row and then the files those rows named. */
  deleteDrawing(drawingId: string): Promise<string[]>;
  /** Owner only. Deletes leftover drawing files from a previous storage failure. */
  sweepDrawingOrphans(): Promise<void>;
  listAssignments(siteId: string): Promise<SiteAssignment[]>;
  /** Own-company owner display name and role. Null when this member cannot open a site. */
  companyOwnerLabel(): Promise<{ display_name: string | null; role: 'owner' } | null>;
  contractsManagerNames(siteId: string): Promise<string[]>;
  addAssignment(siteId: string, personId: string): Promise<void>;
  removeAssignment(assignmentId: string): Promise<void>;
  listCompanyPeople(): Promise<Person[]>;
  companyContacts(): Promise<CompanyContact[]>;
  companyPeople(): Promise<CompanyPerson[]>;
  addNoLoginOperative(input: AddNoLoginOperativeInput): Promise<string>;
  removeOperativeFromSite(personId: string, siteId: string): Promise<void>;
  /** Owner only. operative to cm, or cm to operative. */
  setPersonRole(personId: string, role: 'cm' | 'operative'): Promise<void>;
  uploadDrawingFile(params: {
    companyId: string;
    siteId: string;
    drawingId: string;
    bytes: Uint8Array;
    contentType: string;
    fileName: string;
  }): Promise<{ storagePath: string; fileSizeBytes: number }>;
  replaceDrawing(input: ReplaceDrawingInput): Promise<Drawing>;
  /** Delete a drawing file that was uploaded but whose row was refused. */
  removeUncommittedDrawing(storagePath: string): Promise<void>;
  invitePerson(input: InviteInput): Promise<void>;
  attachLogin(personId: string, email: string): Promise<void>;
  listPeopleGroups(): Promise<PeopleGroup[]>;
  createPeopleGroup(name: string): Promise<string>;
  renamePeopleGroup(groupId: string, name: string): Promise<void>;
  deletePeopleGroup(groupId: string): Promise<void>;
  setPeopleGroupMembers(groupId: string, personIds: string[]): Promise<void>;
  assignGroupToSites(groupId: string, siteIds: string[]): Promise<{ added: number }>;
  removeGroupFromSite(groupId: string, siteId: string): Promise<{ removed: number }>;
  getDrawingOpenUrl(drawing: Drawing): Promise<string>;
  signInWithUsername(username: string, password: string): Promise<SignInResult>;
  createJoinCode(input: {
    siteId: string;
    label?: string | null;
    maxUses?: number;
    hours?: number;
  }): Promise<JoinCodeCreated>;
  listJoinCodes(siteId: string): Promise<JoinCodeRow[]>;
  revokeJoinCode(codeId: string): Promise<void>;
  listJoiners(siteId: string): Promise<JoinerRow[]>;
  removeJoiner(personId: string, siteId: string, revokeCode: boolean): Promise<void>;
  issuePasswordReset(personId: string): Promise<PasswordResetIssued>;
  redeemPasswordReset(code: string, password: string): Promise<void>;
  joinWithCode(input: JoinWithCodeInput): Promise<{ person: Person; siteId: string }>;
  acknowledgePasswordReset(): Promise<void>;
  companyName(): Promise<string>;
  companyMark(): Promise<CompanyMark>;
  setCompanyLogo(photo: { bytes: Uint8Array; contentType: string } | null): Promise<CompanyMark>;
  listVariations(siteId: string): Promise<VariationList>;
  getVariation(variationId: string): Promise<VariationDetail | null>;
  createVariation(input: CreateVariationInput): Promise<{ variationId: string; versionId: string; voSeq: number }>;
  updateVariationDraft(
    versionId: string,
    input: {
      title: string;
      description: string;
      levelArea?: string | null;
      quantityText?: string | null;
      photos: VariationPhotoInput[];
    }
  ): Promise<void>;
  setVariationValue(versionId: string, valuePence: number | null): Promise<void>;
  signVariation(
    versionId: string,
    input: { signerName: string; role: string; company: string; expectedPence: number | null; signaturePng: string }
  ): Promise<void>;
  sendVariation(versionId: string): Promise<void>;
  reviseVariation(versionId: string): Promise<{ versionId: string }>;
  uploadSitePhoto(params: {
    companyId: string;
    siteId: string;
    bytes: Uint8Array;
    contentType: string;
    folder?: 'variations' | 'snags';
    snagId?: string;
  }): Promise<{ storagePath: string; fileSizeBytes: number; contentType: string }>;
  listSnags(siteId: string): Promise<SnagList>;
  snagReport(siteId: string): Promise<SnagReport>;
  getSnag(snagId: string): Promise<SnagDetail | null>;
  createSnag(input: CreateSnagInput): Promise<CreateSnagResult>;
  fixSnag(snagId: string, fixedAt: string, photos: SnagPhotoInput[], fixId?: string | null): Promise<{ alreadyFixed?: boolean }>;
  removeSitePhotos(storagePaths: string[]): Promise<void>;
  signOffSnagsInternal(input: SignOffSnagsInput): Promise<SnagSignoff>;
  signOffSnagsContractor(input: SignOffSnagsInput): Promise<SnagSignoff>;
  snagTradeLabels(siteId: string): Promise<string[]>;
  signSitePhotoUrl(storagePath: string): Promise<{ url: string; expiresAt: string }>;
  listMyUnseenDrawings(): Promise<UnseenDrawing[]>;
  myDrawingProof(drawingId: string): Promise<DrawingProof>;
  siteDrawingSeen(siteId: string): Promise<SiteSeenSummary>;
  siteNotSeen(siteId: string): Promise<NotSeenPerson[]>;
  drawingSeenRoster(drawingId: string): Promise<DrawingRoster>;
  managerDrawingGaps(): Promise<SiteSeenGap[]>;
  recordDrawingOpen(drawingId: string): Promise<void>;
  confirmDrawingSeen(drawingId: string, seenAt?: string | null): Promise<{ seenAt: string }>;
  listSiteDocuments(siteId: string): Promise<SiteDocumentSummary[]>;
  /** Current unsigned RAMS and inductions this person must sign. One read. */
  listUnsignedSiteDocuments(): Promise<UnsignedSignDocument[]>;
  getSiteDocument(documentId: string): Promise<SiteDocumentDetail | null>;
  createSiteDocument(input: CreateSiteDocumentInput): Promise<{ id: string }>;
  replaceSiteDocument(input: ReplaceSiteDocumentInput): Promise<void>;
  deleteSiteDocument(documentId: string): Promise<void>;
  archiveSiteDocument(documentId: string): Promise<void>;
  signSiteDocument(input: SignSiteDocumentInput): Promise<void>;
  siteDocumentUrl(storagePath: string): Promise<string>;
};

export function canManageSite(role: Role): boolean {
  return role === 'cm' || role === 'owner';
}

export type RpcErrorLike = {
  message?: string | null;
  details?: string | null;
  code?: string | null;
};

/**
 * Turn a Supabase or Postgres error into a short code, or a plain sentence
 * when a drawing tag is longer than the check constraint allows.
 */
export function rpcErrorCode(error: string | RpcErrorLike | undefined | null): string {
  const message = typeof error === 'string' ? error : (error?.message ?? '');
  const details = typeof error === 'object' && error ? (error.details ?? '') : '';
  const code = typeof error === 'object' && error ? (error.code ?? '') : '';
  const haystack = `${message}\n${details}`;
  const checkViolation = code === '23514' || /check constraint/i.test(haystack);
  if ((checkViolation || haystack.includes('drawings_folder_len')) && haystack.includes('drawings_folder_len')) {
    return 'Folder name must be 40 characters or fewer.';
  }
  if ((checkViolation || haystack.includes('drawings_level_len')) && haystack.includes('drawings_level_len')) {
    return 'Level must be 40 characters or fewer.';
  }

  const text = haystack;
  for (const known of [
    'not_authorized',
    'site_not_found',
    'site_required',
    'replace_target_not_current',
    'storage_path_required',
    'person_not_in_company',
    'name_in_use',
    'name_too_long',
    'name_required',
    'email_required',
    'email_in_use',
    'already_has_login',
    'join_rejected',
    'username_taken',
    'invalid_input',
    'weak_password',
    'cap_out_of_range',
    'expiry_out_of_range',
    'label_too_long',
    'pepper_not_configured',
    'rate_limited',
    'reset_rejected',
    'sign_in_failed',
    'email_change_blocked',
    'variation_locked',
    'value_not_allowed',
    'photo_count',
    'photo_too_large',
    'invalid_path',
    'signature_required',
    'invalid_status',
    'invalid_input',
    'not_opened',
    'not_current',
    'drawing_not_found',
    'site_archived',
    'storage_orphan',
    'snag_locked',
    'invalid_time',
    'after_photo_required',
    'closed',
    'snag_list_changed',
    'not_found',
  ]) {
    if (text.includes(known)) return known;
  }
  return 'unknown';
}
