export type Role = 'operative' | 'cm' | 'owner';
export type RequestStatus = 'Open' | 'Sent' | 'Closed';

export type Person = {
  id: string;
  /** Login. Null means no login. This loop does not create a null. */
  auth_user_id: string | null;
  company_id: string;
  role: Role;
  trade: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};

export type Site = {
  id: string;
  company_id: string;
  name: string;
  address_line: string | null;
  main_contractor: string | null;
  what_it_is: string | null;
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
  siteId?: string | null;
};

export type HomeSite = Site & {
  my_open_request_count?: number;
  open_request_count?: number;
};
