import appConfig from '../app.json' with { type: 'json' };
import { formatJoinCode, normalizeJoinCode } from '@/data/joinCodes';
import { snagFailureFrom, snagRpcError } from '@/data/snagFailure';

export const SHARE_DAYS = 7;
export const SHARE_COMPANY_PLACEHOLDER = 'e.g. Kerr Construction';

export type ShareSections = {
  drawings: boolean;
  variations: boolean;
  snags: boolean;
  sign_in: boolean;
  inductions: boolean;
};

/** Nothing is shared until the owner turns a section on. Sign-in and inductions stay off. */
export const SHARE_SECTION_DEFAULTS: ShareSections = {
  drawings: false,
  variations: false,
  snags: false,
  sign_in: false,
  inductions: false,
};

/** Labels the host, the copied text, and the guest all use for the same sections. */
export const SHARE_SECTION_LABELS: { key: keyof ShareSections; label: string }[] = [
  { key: 'drawings', label: 'Drawings' },
  { key: 'variations', label: 'Variations' },
  { key: 'snags', label: 'Snags report' },
  { key: 'sign_in', label: 'Sign-in register' },
  { key: 'inductions', label: 'Inductions register' },
];

/** The sections that are actually on. An empty share says so. */
export function sharedSectionList(sections: ShareSections): string {
  const on = SHARE_SECTION_LABELS.filter((row) => sections[row.key]).map((row) => row.label);
  return on.length > 0 ? on.join(', ') : 'nothing yet';
}

/** Shown before a code is opened, on the host card, and in the copied invite. */
export function sharedSectionLine(sections: ShareSections): string {
  return `They will see: ${sharedSectionList(sections)}`;
}

/** Confirm copy. Names what the other firm loses, which is the sections that are on. */
export function stopSharingBody(sections: ShareSections): string {
  return `They will lose: ${sharedSectionList(sections)}. They lose this site on their next open, and their copy of it is wiped.`;
}

/**
 * Base URL for a copied share link. The env wins, then app.json extra.webOrigin.
 * The preview host lives in that config, not in this file.
 */
export function shareWebOrigin(): string {
  const fromEnv = process.env.EXPO_PUBLIC_WEB_ORIGIN?.trim() ?? '';
  const fromConfig = appConfig.expo.extra?.webOrigin?.trim() ?? '';
  return (fromEnv || fromConfig).replace(/\/$/, '');
}

export type ShareInviteCreated = {
  id: string;
  code: string;
  expires_at: string;
  site_id: string;
  site_name: string;
  guest_company_name: string;
  sections: ShareSections;
};

export type ShareInviteRow = {
  id: string;
  guest_company_name: string;
  expires_at: string;
  uses: number;
  revoked_at: string | null;
  created_at: string;
  sections: ShareSections;
};

export type ShareStatus = 'pending' | 'approved' | 'declined';

export type SiteShareRow = {
  id: string;
  guest_company_id: string;
  guest_company_name: string;
  current_company_name: string;
  renamed: boolean;
  redeemer_name: string;
  redeemer_email: string;
  redeemed_at: string;
  status: ShareStatus;
  approved_at: string | null;
  approved_by_name: string | null;
  declined_at: string | null;
  revoked_at: string | null;
  site_name: string;
  /** The invite's expiry. This is not a share end date. */
  code_expires_at: string | null;
  sections: ShareSections;
};

export type ShareCodePreview = {
  site_name: string;
  host_company_name: string;
  expires_at: string;
  sections: ShareSections;
};

export type ShareNotice = {
  share_id: string;
  site_id: string;
  site_name: string;
  guest_company_name: string;
  current_company_name: string;
  renamed: boolean;
  redeemer_name: string;
  redeemer_email: string;
  redeemed_at: string;
  code_expires_at: string | null;
  sections: ShareSections;
};

export type SiteShareList = {
  invites: ShareInviteRow[];
  shares: SiteShareRow[];
};

export type SharedSiteCard = {
  share_id: string;
  site_id: string;
  site_name: string;
  host_company_name: string;
  cm_contact_name: string | null;
  sections: ShareSections;
};

export type SharedSiteView = {
  site_id: string;
  site_name: string;
  address_line: string | null;
  host_company_name: string;
  cm_contact_name: string | null;
  sections: ShareSections;
};

export type SharedDrawing = {
  id: string;
  title: string;
  sheet_number: string | null;
  revision: string;
  dated: string | null;
  level: string | null;
  folder: string | null;
};

export type SharedVariation = {
  id: string;
  vo_seq: number;
  version_id: string;
  title: string;
  description: string;
  level_area: string | null;
  quantity_text: string | null;
  status: 'Signed' | 'Sent';
  signer_name: string | null;
  signer_company: string | null;
};

export type SharedSnag = {
  id: string;
  snag_seq: number;
  note: string;
  level_area: string | null;
  trade_label: string;
  status: string;
  raised_by_name: string;
  raised_at: string;
  fixed_by_name: string | null;
};

export type SharedSignInRow = {
  id: string;
  person_name: string;
  in_at: string;
  out_at: string | null;
};

export type SharedInductionRow = {
  id: string;
  talk_id: string;
  title: string;
  person_name: string;
  meaning: string;
  received_at: string;
};

export type ShareDrawingUrl = {
  url: string;
  expires_in: number;
};

export const SHARE_BUSINESS_CODES = [
  'other_firm',
  'code_expired',
  'code_used',
  'code_revoked',
  'share_revoked',
  'own_firm',
  'already_shared',
  'section_off',
  'not_shared',
  'not_current',
  'invalid_path',
  'invalid_input',
  'not_authorized',
  'not_allowed',
  'too_many_attempts',
  'code_in_use',
] as const;

export type ShareBusinessCode = (typeof SHARE_BUSINESS_CODES)[number];

export type ShareFailure =
  | { kind: 'network' }
  | { kind: 'http'; status: number }
  | { kind: 'business'; code: string };

const NOTICES: Record<string, string> = {
  other_firm: 'That code could not be used.',
  code_expired: 'That code could not be used.',
  code_used: 'That code could not be used.',
  code_revoked: 'That code could not be used.',
  share_revoked: 'Access removed. This site is no longer shared with your company.',
  own_firm: 'Share with the main contractor, not your company.',
  already_shared: 'That code could not be used.',
  section_off: 'That section is not shared.',
  not_shared: 'This site is not shared with your company.',
  not_current: 'That drawing is not the current revision.',
  invalid_path: 'That file cannot be opened.',
  invalid_input: 'That code could not be used.',
  not_authorized: 'You can’t do that.',
  not_allowed: 'Ask an owner or contracts manager to open this code.',
  too_many_attempts: 'Too many tries. Wait an hour and try again.',
  code_in_use: 'Try the share again.',
};

/** Trim, collapse spaces, then lower-case. "  FIRM   y " matches Firm Y. */
export function shareCompanyKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Unused codes the owner can still cancel, including ones that have expired. */
export function pendingShareInvites<T extends { revoked_at: string | null; uses: number }>(invites: readonly T[]): T[] {
  return invites.filter((row) => !row.revoked_at && row.uses < 1);
}

/** The sentence on a pending-approval card. The firm name is the one pinned at redeem. */
export function pendingShareRequestLabel(row: {
  guest_company_name: string;
  redeemer_name: string;
  redeemer_email: string;
  site_name: string;
}): string {
  return `${row.guest_company_name} (${row.redeemer_name}, ${row.redeemer_email}) wants to see ${row.site_name}`;
}

/** Shown when the firm has changed its name since the code was redeemed. */
export function shareRenameNote(row: { renamed: boolean; current_company_name: string }): string | null {
  if (!row.renamed) return null;
  return `Now called ${row.current_company_name}. The name above was pinned when they redeemed.`;
}

/** Pending card status. An unused code past its expiry reads Expired. */
export function pendingInviteLabel(invite: { expires_at: string }, now = Date.now()): string {
  const expired = new Date(invite.expires_at).getTime() <= now;
  const state = expired ? 'Expired' : 'Unused';
  return `${state}. Cancel it if you do not want it opened.`;
}

export function shareInviteText(input: {
  company: string;
  site: string;
  code: string;
  sections: ShareSections;
  origin?: string;
}): string {
  const compact = normalizeJoinCode(input.code);
  const origin = (input.origin ?? shareWebOrigin()).replace(/\/$/, '');
  return `${input.company} can view ${input.site} on SitePack: ${origin}/share/${compact} Code: ${formatJoinCode(compact)} ${sharedSectionLine(input.sections)}`;
}

export function accessRemovedMessage(): string {
  return NOTICES.share_revoked;
}

type ShareErrorLike = {
  message?: string;
  name?: string;
  status?: number;
  code?: string;
};

function readStatus(error: ShareErrorLike): number | undefined {
  return typeof error.status === 'number' ? error.status : undefined;
}

function businessCode(text: string): string | null {
  return SHARE_BUSINESS_CODES.find((code) => text.includes(code)) ?? null;
}

/** Network, an HTTP status, or a business code. Business codes are not retried. */
export function classifyShareFailure(error: unknown): ShareFailure {
  const failure = snagFailureFrom(error);
  if (failure.kind === 'network') return { kind: 'network' };
  if (failure.kind === 'http') {
    const code = businessCode(failure.message);
    if (code && failure.status !== 408 && failure.status !== 429 && failure.status < 500) {
      return { kind: 'business', code };
    }
    return { kind: 'http', status: failure.status };
  }
  return { kind: 'business', code: failure.code };
}

/** Retry a dropped connection, a timeout, 408, 429, and 5xx. A business code is shown instead. */
export function shareFailureRetries(failure: ShareFailure): boolean {
  if (failure.kind === 'business') return false;
  if (failure.kind === 'network') return true;
  return failure.status === 408 || failure.status === 429 || failure.status >= 500;
}

export function shareFailureNotice(failure: ShareFailure): string {
  if (failure.kind === 'business') return NOTICES[failure.code] ?? 'That did not work.';
  if (shareFailureRetries(failure)) return 'The connection dropped. Try again.';
  return 'That did not work.';
}

/**
 * Edge functions put a network failure on FunctionsFetchError and an HTTP status on the Response.
 * The same helper the repo throws, so a dropped share call is retried.
 */
export async function throwShareFunction(error: unknown): Promise<never> {
  const context =
    error && typeof error === 'object' && 'context' in error ? (error as { context?: unknown }).context : undefined;
  if (context instanceof Response) {
    let code = '';
    try {
      const payload = (await context.clone().json()) as { error?: unknown };
      if (typeof payload.error === 'string') code = payload.error;
    } catch {
      code = '';
    }
    throw snagRpcError(code ? { message: code, code } : error, context.status);
  }
  throw snagRpcError(error);
}

export async function withShareRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!shareFailureRetries(classifyShareFailure(error)) || attempt === attempts - 1) throw error;
    }
  }
  throw last;
}

export function droppedSharedSiteIds(previous: readonly string[], next: readonly string[]): string[] {
  const keep = new Set(next);
  return previous.filter((id) => !keep.has(id));
}

const SHARED_IDS_KEY = 'sitepack.shared.ids';

/** Remember which sites this phone was allowed to see, and return the ones that disappeared. */
export function rememberSharedSiteIds(
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void },
  next: readonly string[]
): string[] {
  let previous: string[] = [];
  try {
    const raw = storage.getItem(SHARED_IDS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) previous = parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    previous = [];
  }
  storage.setItem(SHARED_IDS_KEY, JSON.stringify([...next]));
  return droppedSharedSiteIds(previous, next);
}

type StorageLike = {
  length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const SITE_LIST_KEY = 'sitepack.offline.sites';

function withoutSite(raw: string, siteId: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return raw;
    const next = parsed.filter((item) => {
      if (!item || typeof item !== 'object') return true;
      const row = item as { siteId?: unknown; site_id?: unknown; id?: unknown };
      return row.siteId !== siteId && row.site_id !== siteId && row.id !== siteId;
    });
    return JSON.stringify(next);
  } catch {
    return raw;
  }
}

/** Drop this site's offline pack, cached card, and queued rows. */
export function forgetSharedSiteStorage(storage: StorageLike, siteId: string): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  for (const key of keys) {
    if (key === `sitepack.offline.pack.${siteId}`) {
      storage.removeItem(key);
      continue;
    }
    if (!key.startsWith('sitepack.')) continue;
    const raw = storage.getItem(key);
    if (raw == null) continue;
    if (key === SITE_LIST_KEY || key.includes('queue') || key.includes('notice') || key.includes('Notice')) {
      const next = withoutSite(raw, siteId);
      if (next !== raw) storage.setItem(key, next);
    }
  }
}
