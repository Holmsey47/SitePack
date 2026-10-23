export type Role = 'operative' | 'cm' | 'owner';
export type RequestStatus = 'Open' | 'Sent' | 'Closed';

export type Person = {
  id: string;
  /** Login. Null means no login. */
  auth_user_id: string | null;
  company_id: string;
  role: Role;
  trade: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  /** Sign-in name. Null on email logins that never joined with a code. */
  username?: string | null;
  /** Set when a reset code is redeemed. Cleared when the person dismisses the notice. */
  password_reset_at?: string | null;
  created_at: string;
};

export type CompanyContact = {
  id: string;
  email: string | null;
  phone: string | null;
};

export type Site = {
  id: string;
  company_id: string;
  name: string;
  address_line: string | null;
  main_contractor: string | null;
  what_it_is: string | null;
  /** Manual finished mark. Null means the site is on the working list. */
  archived_at: string | null;
  /** Person who archived the site. Null while the site is on the working list. */
  archived_by?: string | null;
  created_at: string;
  updated_at: string;
};

export type SiteAssignment = {
  id: string;
  site_id: string;
  person_id: string;
  created_at: string;
  person?: Person;
};

export type Drawing = {
  id: string;
  site_id: string;
  title: string;
  sheet_number: string | null;
  revision: string;
  dated: string | null;
  is_current: boolean;
  supersedes_id: string | null;
  storage_path: string;
  file_size_bytes: number | null;
  content_type: string;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  /** One-level pack folder. Not part of sheet identity. Blank is Other. */
  folder: string;
  /** Optional free-text level. Not part of sheet identity. Null is blank. */
  level: string | null;
};

export type DrawingRequest = {
  id: string;
  site_id: string;
  requester_id: string;
  body: string;
  sheet_hint: string | null;
  photo_path: string | null;
  status: RequestStatus;
  fulfilled_drawing_id: string | null;
  cm_note: string | null;
  created_at: string;
  updated_at: string;
  site_name?: string;
  requester_name?: string;
};

export type PulseRow = {
  site_id: string;
  name: string;
  address_line: string | null;
  assignee_count: number;
  assignee_names_preview: string[];
  /** Contracts managers on the site. The owner is not included. */
  contracts_manager_names: string[];
  /** Operatives on the site, including a name with no login. The owner is not included. */
  operative_count: number;
  /** Joiners in the last 7 days who have not been removed. */
  new_joiner_count?: number;
  archived_at: string | null;
  last_pack_update: string | null;
  open_request_count: number;
};

export type ManifestItem = {
  drawing_id: string;
  title: string;
  sheet_number: string | null;
  revision: string;
  dated: string | null;
  file_size_bytes: number | null;
  content_type: string;
  storage_path?: string;
  /** Display only. Null when the sheet has no level. */
  level: string | null;
  signed_url: string;
  signed_url_expires_at: string;
};

export type ReplaceDrawingInput = {
  id?: string;
  siteId: string;
  title: string;
  revision: string;
  storagePath: string;
  sheetNumber?: string | null;
  dated?: string | null;
  fileSizeBytes?: number | null;
  contentType?: string | null;
  replaceDrawingId?: string | null;
  /** Null or omitted copies the previous current folder. Blank is stored as Other. */
  folder?: string | null;
  /** Null or omitted copies the previous current level. Blank is stored as null. */
  level?: string | null;
};

export type CreateRequestInput = {
  siteId: string;
  body: string;
  sheetHint?: string | null;
  photoPath?: string | null;
};

export type InviteInput = {
  email: string;
  displayName: string;
  role: Role;
  trade?: string | null;
  /** One site. Prefer siteIds when the invite covers several. */
  siteId?: string | null;
  siteIds?: string[];
};

/** Labour-list row. Site names are text. No email, site id, or login id. */
export type CompanyPerson = {
  id: string;
  display_name: string | null;
  role: Role;
  trade: string | null;
  has_login: boolean;
  /** Sign-in name. Managers only. The people directory does not include it. */
  username?: string | null;
  site_names: string[];
};

/** A named crew. Members are existing people. The group is not a site pass. */
export type PeopleGroupMember = {
  person_id: string;
  display_name: string | null;
  role: Role | null;
  trade: string | null;
  /** Null when this caller cannot see that person. */
  has_login: boolean | null;
};

export type PeopleGroup = {
  id: string;
  company_id: string;
  name: string;
  created_at: string;
  created_by: string | null;
  members: PeopleGroupMember[];
};

export type AddNoLoginOperativeInput = {
  displayName: string;
  trade?: string | null;
  siteIds: string[];
};

export type HomeSite = Site & {
  my_open_request_count?: number;
  open_request_count?: number;
};

export type JoinCodeCreated = {
  id: string;
  code: string;
  expires_at: string;
  max_uses: number;
  label: string | null;
  site_id: string;
  site_name: string;
  company_name: string;
};

export type JoinCodeRow = {
  id: string;
  site_id: string;
  label: string | null;
  expires_at: string;
  max_uses: number;
  uses: number;
  revoked_at: string | null;
  created_at: string;
};

export type JoinerRow = {
  id: string;
  person_id: string | null;
  display_name: string | null;
  trade: string | null;
  username: string | null;
  joined_at: string;
  removed_at: string | null;
  code_id: string;
  code_label: string | null;
};

export type JoinWithCodeInput = {
  code: string;
  displayName: string;
  trade: string;
  username: string;
  password: string;
};

export type PasswordResetIssued = {
  code: string;
  expires_at: string;
  person_id: string;
};
