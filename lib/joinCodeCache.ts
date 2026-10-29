import type { JoinCodeCreated, JoinCodeRow } from '@/data/types';
import { formatCodeExpiry } from '@/lib/format';

/** One blob, keyed by join-code id. The plaintext never goes to the database. */
export const JOIN_CODE_CACHE_KEY = 'sitepack.join-codes';

export const OLD_CODE_STOPS = 'The old code stops working now';
export const REVOKE_FAILED = 'Could not replace the code. It still works.';
export const ISSUE_AFTER_REVOKE_FAILED = 'The old code has stopped. Make a new one.';

export type JoinCodePlaintext = Record<string, string>;

export type JoinCodeCachePort = {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  remove: () => Promise<void>;
};

export type ActiveCodeView =
  | { kind: 'empty' }
  | { kind: 'cached'; row: JoinCodeRow; code: string }
  | { kind: 'elsewhere'; row: JoinCodeRow };

export type RegenerateDeps = {
  codeId: string;
  revoke: (codeId: string) => Promise<void>;
  forget: (codeId: string) => Promise<void>;
  onRevoked: () => void;
  issue: () => Promise<JoinCodeCreated>;
  remember: (created: JoinCodeCreated) => Promise<void>;
};

export type RegenerateResult =
  | { status: 'issued'; created: JoinCodeCreated }
  | { status: 'revoke_failed' }
  | { status: 'issue_failed' };

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isCacheId(id: string): boolean {
  return id.length > 0 && id.length <= 80 && !/\s/.test(id);
}

function isCacheCode(code: unknown): code is string {
  return typeof code === 'string' && code.length >= 4 && code.length <= 40 && !/\s/.test(code);
}

export function parseJoinCodeCache(raw: string | null): JoinCodePlaintext {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const codes: JoinCodePlaintext = {};
    for (const [id, code] of Object.entries(parsed)) {
      if (BLOCKED_KEYS.has(id) || !isCacheId(id) || !isCacheCode(code)) continue;
      codes[id] = code;
    }
    return codes;
  } catch {
    return {};
  }
}

export async function readJoinCodeCache(port: JoinCodeCachePort): Promise<JoinCodePlaintext> {
  return parseJoinCodeCache(await port.read());
}

export async function writeJoinCodeCache(port: JoinCodeCachePort, codes: JoinCodePlaintext): Promise<void> {
  if (Object.keys(codes).length === 0) {
    await port.remove();
    return;
  }
  await port.write(JSON.stringify(codes));
}

export async function rememberJoinCode(port: JoinCodeCachePort, id: string, code: string): Promise<void> {
  if (!isCacheId(id) || !isCacheCode(code)) return;
  const current = await readJoinCodeCache(port);
  current[id] = code;
  await writeJoinCodeCache(port, current);
}

export async function forgetJoinCode(port: JoinCodeCachePort, id: string): Promise<void> {
  const current = await readJoinCodeCache(port);
  if (!(id in current)) return;
  delete current[id];
  await writeJoinCodeCache(port, current);
}

export async function clearJoinCodeCache(port: JoinCodeCachePort): Promise<void> {
  await port.remove();
}

/** Not revoked, not expired, and still under the use cap. */
export function isActiveJoinCode(row: JoinCodeRow, now = Date.now()): boolean {
  if (row.revoked_at) return false;
  const expires = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expires) || expires <= now) return false;
  if (!(row.max_uses > 0) || row.uses >= row.max_uses) return false;
  return true;
}

function byNewest(a: JoinCodeRow, b: JoinCodeRow): number {
  if (a.created_at === b.created_at) return 0;
  return a.created_at < b.created_at ? 1 : -1;
}

export function chooseActiveJoinCode(
  rows: JoinCodeRow[],
  cached: JoinCodePlaintext,
  now = Date.now(),
): JoinCodeRow | null {
  const active = rows.filter((row) => isActiveJoinCode(row, now));
  const known = active.filter((row) => cached[row.id]).sort(byNewest);
  if (known[0]) return known[0];
  return [...active].sort(byNewest)[0] ?? null;
}

export function viewActiveCode(rows: JoinCodeRow[], cached: JoinCodePlaintext, now = Date.now()): ActiveCodeView {
  const row = chooseActiveJoinCode(rows, cached, now);
  if (!row) return { kind: 'empty' };
  const code = cached[row.id];
  if (code) return { kind: 'cached', row, code };
  return { kind: 'elsewhere', row };
}

export function staleCacheIds(rows: JoinCodeRow[], cached: JoinCodePlaintext, now = Date.now()): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return Object.keys(cached).filter((id) => {
    const row = byId.get(id);
    return row != null && !isActiveJoinCode(row, now);
  });
}

export function activeCodeNotice(expiresAt: string, now: Date | string | number = new Date()): string {
  const formatted = formatCodeExpiry(expiresAt, now);
  const when = formatted.startsWith('Ends ') ? formatted.slice('Ends '.length) : formatted;
  return `A code is active until ${when}. Make a new one to share it from this phone.`;
}

/** List only. Opening invite must not issue a code. */
export async function loadJoinCodeScreen(input: {
  list: () => Promise<JoinCodeRow[]>;
  cache: JoinCodeCachePort;
  now?: number;
}): Promise<ActiveCodeView> {
  const now = input.now ?? Date.now();
  const [rows, cached] = await Promise.all([input.list(), readJoinCodeCache(input.cache)]);
  const stale = staleCacheIds(rows, cached, now);
  let current = cached;
  if (stale.length > 0) {
    current = { ...cached };
    for (const id of stale) delete current[id];
    await writeJoinCodeCache(input.cache, current);
  }
  return viewActiveCode(rows, current, now);
}

/**
 * Revoke first, drop the plaintext, then issue.
 * A failed issue must not put the old code back on screen.
 */
export async function regenerateJoinCode(input: RegenerateDeps): Promise<RegenerateResult> {
  try {
    await input.revoke(input.codeId);
  } catch {
    return { status: 'revoke_failed' };
  }
  try {
    await input.forget(input.codeId);
  } catch {
    // The screen still drops the code. Sign-out and the next list clear storage.
  }
  input.onRevoked();
  try {
    const created = await input.issue();
    try {
      await input.remember(created);
    } catch {
      // This visit still shows the new code. The next open can regenerate.
    }
    return { status: 'issued', created };
  } catch {
    return { status: 'issue_failed' };
  }
}

export async function confirmThenRegenerate(
  confirmed: boolean,
  input: RegenerateDeps,
): Promise<RegenerateResult | { status: 'cancelled' }> {
  if (!confirmed) return { status: 'cancelled' };
  return regenerateJoinCode(input);
}

export function joinCodeRowFromCreated(created: JoinCodeCreated, createdAt = new Date().toISOString()): JoinCodeRow {
  return {
    id: created.id,
    site_id: created.site_id,
    label: created.label,
    expires_at: created.expires_at,
    max_uses: created.max_uses,
    uses: 0,
    revoked_at: null,
    created_at: createdAt,
  };
}
