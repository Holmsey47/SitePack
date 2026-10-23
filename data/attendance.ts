import { SnagRequestError } from '@/data/snagFailure';
import type { Role } from '@/data/types';
import { clockGap, describeShift, londonTimeLabel, priorPhrase, LATE_SIGN_OUT_REASON, type HourSpan } from '@/lib/attendanceHours';

export type AttendanceState = 'in' | 'out';

export type AttendanceAudit = {
  id: string;
  reason: string;
  corrected_by_name: string;
  before_entry: Record<string, unknown>;
  after_entry: Record<string, unknown>;
  created_at: string;
};

export type AttendanceEntry = {
  entry_id: string;
  site_id: string;
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
  late_sign_out: boolean;
  late_out_device_at: string | null;
  late_out_received_at: string | null;
  late_out_at: string | null;
  state: AttendanceState;
  audit: AttendanceAudit[] | null;
};

export type MySiteAttendance = {
  state: AttendanceState;
  entry: AttendanceEntry | null;
};

export type OnSiteNow = {
  rows: Array<Pick<AttendanceEntry, 'entry_id' | 'person_id' | 'person_name' | 'in_at' | 'in_device_at' | 'in_received_at' | 'in_gap'>>;
};

export type WeeklyAttendance = {
  week_start: string;
  entries: AttendanceEntry[];
};

export function canManageHours(role: Role): boolean {
  return role === 'owner' || role === 'cm';
}

export function hourSpans(entries: AttendanceEntry[]): HourSpan[] {
  return entries.map((entry) => {
    const audits = (entry.audit ?? [])
      .filter((row) => row.reason !== LATE_SIGN_OUT_REASON)
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const first = audits[0];
    const last = audits[audits.length - 1];
    const before = first?.before_entry ?? {};
    const priorForgot = before.forgot_sign_out === true;
    const priorLate = typeof before.late_out_at === 'string' && before.late_out_at.length > 0;
    const late = entry.late_sign_out || (entry.audit ?? []).some((row) => row.reason === LATE_SIGN_OUT_REASON);
    return {
      personId: entry.person_id,
      personName: entry.person_name,
      inAt: entry.in_at,
      outAt: entry.out_at,
      forgot: entry.forgot_sign_out,
      gap: Boolean(
        entry.in_gap ||
          entry.out_gap ||
          (entry.late_out_device_at && entry.late_out_received_at && clockGap(entry.late_out_device_at, entry.late_out_received_at))
      ),
      late,
      corrected: audits.length > 0,
      correctedBy: last?.corrected_by_name ?? '',
      reason: last?.reason ?? '',
      prior: audits.length > 0 ? priorPhrase(priorForgot, priorLate) : undefined,
    };
  });
}

/** The week card, the PDF, and the CSV all use this wording. */
export function shiftCard(entry: AttendanceEntry): {
  correction: string | null;
  reason: string | null;
  flags: string[];
  /** Set for an uncorrected not-signed-out shift, so the card does not show the 23:59 placeholder. */
  line: string | null;
} {
  const [span] = hourSpans([entry]);
  if (!span) return { correction: null, reason: null, flags: [], line: null };
  const described = describeShift(span, span.forgot);
  const unchecked = span.forgot && !span.corrected && !span.late;
  return {
    correction: described.correction,
    reason: described.reason,
    flags: described.flags,
    line: unchecked ? `In ${londonTimeLabel(span.inAt)}, not signed out` : null,
  };
}

export async function signOutThenSignIn(
  openSiteId: string,
  hereSiteId: string,
  deviceAt: string,
  signOut: (siteId: string, at: string) => Promise<unknown>,
  signIn: (siteId: string, at: string) => Promise<unknown>
): Promise<void> {
  await signOut(openSiteId, deviceAt);
  await signIn(hereSiteId, deviceAt);
}

export const SWITCH_NEEDS_SIGNAL = 'Needs signal';

export function signedOutOfSiteNotice(siteName: string): string {
  return `You are signed out of ${siteName}. Tap Sign in again.`;
}

export type SiteSwitchResult =
  | { kind: 'done' }
  | { kind: 'offline' }
  | { kind: 'sign_out_failed'; error: unknown }
  | { kind: 'signed_out'; notice: string };

/**
 * Sign out of the open site, then sign in here.
 * Offline, or a failed sign-out, does not call sign-in.
 * A sign-in failure after a successful sign-out returns a notice for the old site.
 */
export async function attemptSiteSwitch(
  online: boolean,
  openSiteId: string,
  openSiteName: string,
  hereSiteId: string,
  deviceAt: string,
  signOut: (siteId: string, at: string) => Promise<unknown>,
  signIn: (siteId: string, at: string) => Promise<unknown>
): Promise<SiteSwitchResult> {
  if (!online) return { kind: 'offline' };
  try {
    await signOut(openSiteId, deviceAt);
  } catch (error) {
    return { kind: 'sign_out_failed', error };
  }
  try {
    await signIn(hereSiteId, deviceAt);
  } catch {
    return { kind: 'signed_out', notice: signedOutOfSiteNotice(openSiteName) };
  }
  return { kind: 'done' };
}

export function attendanceError(err: unknown): string {
  const failure = err instanceof SnagRequestError ? err.failure : null;
  const detail = failure?.kind === 'business' ? failure.detail : undefined;
  const code = failure?.kind === 'business' ? failure.code : typeof err === 'string' ? err : err instanceof Error ? err.message : 'unknown';
  switch (code) {
    case 'already_signed_in':
      return detail ? `You are still signed in at ${detail}.` : 'You are already signed in.';
    case 'not_signed_in':
      return 'You are not signed in on this site.';
    case 'not_authorized':
      return 'You cannot do that.';
    case 'invalid_time':
      return 'That time is not valid.';
    case 'invalid_input':
      return 'Check the time and the reason.';
    case 'correction_overlaps':
      return detail ? `That overlaps another shift, ${detail}.` : 'That overlaps another shift.';
    case 'shift_too_long':
      return 'That shift is longer than 24 hours.';
    default:
      return 'Could not save the hours.';
  }
}

export function gapLine(entry: { in_gap: boolean; out_gap: boolean | null }): string | null {
  if (entry.in_gap || entry.out_gap) return 'Phone time was more than 10 minutes out';
  return null;
}

export function forgotLine(entry: { forgot_sign_out: boolean }): string | null {
  return entry.forgot_sign_out ? 'Not signed out' : null;
}
