import { newId } from '@/data/newId';
import type { Role } from '@/data/types';
import type { AttendanceAudit, AttendanceEntry, MySiteAttendance, OnSiteNow, WeeklyAttendance } from '@/data/attendance';
import {
  assertDeviceTime,
  clientNowIso,
  clockGap,
  forgottenClose,
  isMondayKey,
  LATE_SIGN_OUT_REASON,
  londonDateKey,
  londonWeekStart,
} from '@/lib/attendanceHours';

type Actor = { id: string; role: Role; company_id: string; display_name: string };

type Row = {
  id: string;
  site_id: string;
  company_id: string;
  person_id: string;
  person_name: string;
  in_device_at: string;
  in_received_at: string;
  in_at: string;
  in_gap: boolean;
  out_device_at: string | null;
  out_received_at: string | null;
  out_at: string | null;
  out_gap: boolean | null;
  forgot_sign_out: boolean;
  late_out_device_at: string | null;
  late_out_received_at: string | null;
  late_out_at: string | null;
};

type AuditRow = {
  id: string;
  entry_id: string;
  site_id: string;
  company_id: string;
  corrected_by: string;
  corrected_by_name: string;
  reason: string;
  before_entry: Record<string, unknown>;
  after_entry: Record<string, unknown>;
  created_at: string;
};

export type FixtureAttendanceBucket = {
  rows: Row[];
  audit: AuditRow[];
};

export function emptyAttendance(): FixtureAttendanceBucket {
  return { rows: [], audit: [] };
}

function manager(actor: Actor): boolean {
  return actor.role === 'owner' || actor.role === 'cm';
}

function label(name: string): string {
  const trimmed = name.trim();
  return (trimmed || 'Someone on site').slice(0, 120);
}

function canSee(actor: Actor, row: Row, canAccess: (siteId: string) => boolean): boolean {
  if (row.company_id !== actor.company_id || !canAccess(row.site_id)) return false;
  if (manager(actor)) return true;
  return row.person_id === actor.id;
}

function requireSite(actor: Actor, siteCompanyId: string | undefined, canAccess: boolean) {
  if (!siteCompanyId || siteCompanyId !== actor.company_id || !canAccess) throw new Error('not_authorized');
}

function snapshot(row: Row): Record<string, unknown> {
  return {
    in_at: row.in_at,
    out_at: row.out_at,
    in_device_at: row.in_device_at,
    in_received_at: row.in_received_at,
    out_device_at: row.out_device_at,
    out_received_at: row.out_received_at,
    forgot_sign_out: row.forgot_sign_out,
    in_gap: row.in_gap,
    out_gap: row.out_gap,
    late_out_at: row.late_out_at,
    late_out_device_at: row.late_out_device_at,
    late_out_received_at: row.late_out_received_at,
  };
}

function auditsFor(bucket: FixtureAttendanceBucket, actor: Actor, entryId: string): AttendanceAudit[] | null {
  if (!manager(actor)) return null;
  return bucket.audit
    .filter((row) => row.entry_id === entryId)
    .map((row) => ({
      id: row.id,
      reason: row.reason,
      corrected_by_name: row.corrected_by_name,
      before_entry: row.before_entry,
      after_entry: row.after_entry,
      created_at: row.created_at,
    }));
}

function toEntry(bucket: FixtureAttendanceBucket, actor: Actor, row: Row): AttendanceEntry {
  return {
    entry_id: row.id,
    site_id: row.site_id,
    person_id: row.person_id,
    person_name: row.person_name,
    in_device_at: row.in_device_at,
    in_received_at: row.in_received_at,
    in_at: row.in_at,
    in_gap: row.in_gap,
    out_device_at: row.out_device_at,
    out_received_at: row.out_received_at,
    out_at: row.out_at,
    out_gap: row.out_gap,
    forgot_sign_out: row.forgot_sign_out,
    late_sign_out: row.late_out_at != null,
    late_out_device_at: row.late_out_device_at,
    late_out_received_at: row.late_out_received_at,
    late_out_at: row.late_out_at,
    state: row.out_at ? 'out' : 'in',
    audit: auditsFor(bucket, actor, row.id),
  };
}

export function closeForgotten(bucket: FixtureAttendanceBucket, companyId: string, nowIso: string): number {
  let count = 0;
  for (const row of bucket.rows) {
    if (row.company_id !== companyId || row.out_at) continue;
    const closed = forgottenClose(row.in_at, row.out_at, nowIso);
    if (!closed) continue;
    row.out_at = closed.outAt;
    row.out_received_at = nowIso;
    row.out_gap = false;
    row.forgot_sign_out = true;
    count += 1;
  }
  return count;
}

export function fixtureSignIn(
  bucket: FixtureAttendanceBucket,
  actor: Actor,
  siteId: string,
  siteCompanyId: string | undefined,
  canAccess: boolean,
  deviceAt: string,
  receivedAt = clientNowIso()
): AttendanceEntry {
  requireSite(actor, siteCompanyId, canAccess);
  const device = assertDeviceTime(deviceAt, new Date(receivedAt).getTime());
  closeForgotten(bucket, actor.company_id, receivedAt);
  if (bucket.rows.some((row) => row.person_id === actor.id && !row.out_at)) throw new Error('already_signed_in');
  const row: Row = {
    id: newId(),
    site_id: siteId,
    company_id: actor.company_id,
    person_id: actor.id,
    person_name: label(actor.display_name),
    in_device_at: device,
    in_received_at: receivedAt,
    in_at: receivedAt,
    in_gap: clockGap(device, receivedAt),
    out_device_at: null,
    out_received_at: null,
    out_at: null,
    out_gap: null,
    forgot_sign_out: false,
    late_out_device_at: null,
    late_out_received_at: null,
    late_out_at: null,
  };
  bucket.rows.push(row);
  return toEntry(bucket, actor, row);
}

export function fixtureSignOut(
  bucket: FixtureAttendanceBucket,
  actor: Actor,
  siteId: string,
  siteCompanyId: string | undefined,
  canAccess: boolean,
  deviceAt: string,
  receivedAt = clientNowIso()
): AttendanceEntry {
  requireSite(actor, siteCompanyId, canAccess);
  const device = assertDeviceTime(deviceAt, new Date(receivedAt).getTime());
  closeForgotten(bucket, actor.company_id, receivedAt);
  const open = bucket.rows.find((item) => item.person_id === actor.id && item.site_id === siteId && !item.out_at);
  if (open) {
    open.out_device_at = device;
    open.out_received_at = receivedAt;
    open.out_at = receivedAt;
    open.out_gap = clockGap(device, receivedAt);
    return toEntry(bucket, actor, open);
  }
  const late = bucket.rows
    .filter((item) => item.person_id === actor.id && item.site_id === siteId && item.forgot_sign_out && !item.late_out_at)
    .sort((a, b) => (a.in_at < b.in_at ? 1 : -1))[0];
  if (!late) throw new Error('not_signed_in');
  const before = snapshot(late);
  late.late_out_device_at = device;
  late.late_out_received_at = receivedAt;
  late.late_out_at = receivedAt;
  bucket.audit.push({
    id: newId(),
    entry_id: late.id,
    site_id: late.site_id,
    company_id: late.company_id,
    corrected_by: actor.id,
    corrected_by_name: label(actor.display_name),
    reason: LATE_SIGN_OUT_REASON,
    before_entry: before,
    after_entry: snapshot(late),
    created_at: receivedAt,
  });
  return toEntry(bucket, actor, late);
}

export function fixtureMySiteAttendance(
  bucket: FixtureAttendanceBucket,
  actor: Actor,
  siteId: string,
  siteCompanyId: string | undefined,
  canAccess: boolean,
  nowIso = clientNowIso()
): MySiteAttendance {
  requireSite(actor, siteCompanyId, canAccess);
  closeForgotten(bucket, actor.company_id, nowIso);
  const row = bucket.rows.find((item) => item.person_id === actor.id && item.site_id === siteId && !item.out_at);
  return { state: row ? 'in' : 'out', entry: row ? toEntry(bucket, actor, row) : null };
}

export function fixtureListMine(
  bucket: FixtureAttendanceBucket,
  actor: Actor,
  siteId: string,
  siteCompanyId: string | undefined,
  canAccess: boolean,
  nowIso = clientNowIso()
): AttendanceEntry[] {
  requireSite(actor, siteCompanyId, canAccess);
  closeForgotten(bucket, actor.company_id, nowIso);
  return bucket.rows
    .filter((row) => row.site_id === siteId && canSee(actor, row, () => canAccess))
    .sort((a, b) => (a.in_at < b.in_at ? 1 : -1))
    .map((row) => toEntry(bucket, actor, row));
}

export function fixtureOnSiteNow(
  bucket: FixtureAttendanceBucket,
  actor: Actor,
  siteId: string,
  siteCompanyId: string | undefined,
  canAccess: boolean,
  nowIso = clientNowIso()
): OnSiteNow | null {
  requireSite(actor, siteCompanyId, canAccess);
  closeForgotten(bucket, actor.company_id, nowIso);
  if (!manager(actor)) return null;
  const rows = bucket.rows
    .filter((row) => row.site_id === siteId && !row.out_at && canSee(actor, row, () => canAccess))
    .sort((a, b) => (a.in_at < b.in_at ? -1 : 1))
    .map((row) => ({
      entry_id: row.id,
      person_id: row.person_id,
      person_name: row.person_name,
      in_at: row.in_at,
      in_device_at: row.in_device_at,
      in_received_at: row.in_received_at,
      in_gap: row.in_gap,
    }));
  return { rows };
}

export function fixtureWeekly(
  bucket: FixtureAttendanceBucket,
  actor: Actor,
  siteId: string,
  siteCompanyId: string | undefined,
  canAccess: boolean,
  weekStart: string,
  nowIso = clientNowIso()
): WeeklyAttendance | null {
  requireSite(actor, siteCompanyId, canAccess);
  if (!isMondayKey(weekStart)) throw new Error('invalid_input');
  closeForgotten(bucket, actor.company_id, nowIso);
  if (!manager(actor)) return null;
  const entries = bucket.rows
    .filter((row) => row.site_id === siteId && canSee(actor, row, () => canAccess))
    .filter((row) => {
      const inDay = londonDateKey(row.in_at);
      const outDay = londonDateKey(row.out_at ?? nowIso);
      return inDay < addWeek(weekStart) && outDay >= weekStart;
    })
    .map((row) => toEntry(bucket, actor, row));
  return { week_start: weekStart, entries };
}

function addWeek(weekStart: string): string {
  const [year, month, day] = weekStart.split('-').map((value) => Number(value));
  const next = new Date(Date.UTC(year, month - 1, day + 7));
  return next.toISOString().slice(0, 10);
}

export function fixtureAttendanceEntry(
  bucket: FixtureAttendanceBucket,
  actor: Actor,
  entryId: string,
  canAccess: (siteId: string) => boolean,
  nowIso = clientNowIso()
): AttendanceEntry | null {
  closeForgotten(bucket, actor.company_id, nowIso);
  const row = bucket.rows.find((item) => item.id === entryId);
  if (!row || !canSee(actor, row, canAccess)) return null;
  return toEntry(bucket, actor, row);
}

export function fixtureCorrect(
  bucket: FixtureAttendanceBucket,
  actor: Actor,
  entryId: string,
  inAt: string,
  outAt: string,
  reason: string,
  canAccess: (siteId: string) => boolean,
  nowIso = clientNowIso()
): AttendanceEntry {
  if (!manager(actor)) throw new Error('not_authorized');
  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > 500) throw new Error('invalid_input');
  const start = new Date(inAt).getTime();
  const end = new Date(outAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) throw new Error('invalid_input');
  const row = bucket.rows.find((item) => item.id === entryId);
  if (!row || row.company_id !== actor.company_id || !canAccess(row.site_id)) throw new Error('not_authorized');
  const before = snapshot(row);
  row.in_at = new Date(start).toISOString();
  row.out_at = new Date(end).toISOString();
  if (!row.out_received_at) row.out_received_at = nowIso;
  if (row.out_gap == null) row.out_gap = false;
  const after = snapshot(row);
  bucket.audit.push({
    id: newId(),
    entry_id: row.id,
    site_id: row.site_id,
    company_id: row.company_id,
    corrected_by: actor.id,
    corrected_by_name: label(actor.display_name),
    reason: trimmed,
    before_entry: before,
    after_entry: after,
    created_at: nowIso,
  });
  return toEntry(bucket, actor, row);
}

export function currentWeekStart(nowIso = clientNowIso()): string {
  return londonWeekStart(nowIso);
}
