import type { Role } from '@/data/types';

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

export function attendanceError(code: string): string {
  switch (code) {
    case 'already_signed_in':
      return 'You are already signed in.';
    case 'not_signed_in':
      return 'You are not signed in on this site.';
    case 'not_authorized':
      return 'You cannot do that.';
    case 'invalid_time':
      return 'That time is not valid.';
    case 'invalid_input':
      return 'Check the time and the reason.';
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
