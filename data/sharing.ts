import { formatJoinCode, JOIN_WEB_ORIGIN, normalizeJoinCode } from '@/data/joinCodes';

export const SHARE_DAYS = 7;
export const SHARE_COMPANY_PLACEHOLDER = 'your company';

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

export type SiteShareRow = {
  id: string;
  guest_company_id: string;
  guest_company_name: string;
  redeemed_at: string;
  revoked_at: string | null;
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
  'code_in_use',
] as const;

export type ShareBusinessCode = (typeof SHARE_BUSINESS_CODES)[number];

export type ShareFailure =
  | { kind: 'network' }
  | { kind: 'http'; status: number }
  | { kind: 'business'; code: string };

const NOTICES: Record<string, string> = {
  other_firm: 'That code is for a different company.',
  code_expired: 'That code has expired.',
  code_used: 'That code has already been used.',
  code_revoked: 'That code was revoked.',
  share_revoked: 'Access removed. This site is no longer shared with your company.',
  own_firm: 'Share with the main contractor, not your company.',
  already_shared: 'That company already has this site.',
  section_off: 'That section is not shared.',
  not_shared: 'This site is not shared with your company.',
  not_current: 'That drawing is not the current revision.',
  invalid_path: 'That file cannot be opened.',
  invalid_input: 'Check the company name and try again.',
  not_authorized: 'You can’t do that.',
  code_in_use: 'Try the share again.',
};

export function shareCompanyKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function shareInviteText(input: { company: string; site: string; code: string; origin?: string }): string {
  const compact = normalizeJoinCode(input.code);
  const origin = (input.origin ?? JOIN_WEB_ORIGIN).replace(/\/$/, '');
  return `${input.company} can view ${input.site} on SitePack: ${origin}/share/${compact} Code: ${formatJoinCode(compact)}`;
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
  const row = (error ?? {}) as ShareErrorLike;
  const message = typeof row.message === 'string' ? row.message : '';
  const named = typeof row.code === 'string' ? row.code : '';
  const code = businessCode(`${named}\n${message}`);
  if (code) return { kind: 'business', code };
  const status = readStatus(row);
  const network =
    row.name === 'TypeError' ||
    /network|failed to fetch|timeout|network request failed/i.test(message) ||
    status === 0;
  if (network && (status == null || status === 0)) return { kind: 'network' };
  if (status != null) return { kind: 'http', status };
  if (network) return { kind: 'network' };
  return { kind: 'http', status: 0 };
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
