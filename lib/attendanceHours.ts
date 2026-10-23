import { formatDate, formatUkDateTime } from '@/lib/format';

const LONDON = 'Europe/London';

/** More than 10 minutes between the phone and the server. */
export const CLOCK_GAP_MS = 10 * 60 * 1000;

/** An overnight shift from the previous London day stays open until this hour the next morning. */
export const OVERNIGHT_GRACE_HOUR = 6;

/** Signed in at or after this London hour. A day shift is not held overnight. */
export const OVERNIGHT_START_HOUR = 14;

/**
 * (24 - start) + grace, so a 14:00 sign-in reaches exactly 06:00 on a 24 hour day.
 * On the October clock-change night a 14:00 BST sign-in loses the hold at 05:00 GMT,
 * because these 16 hours run out first. That is intended.
 */
export const OVERNIGHT_HOLD_HOURS = 24 - OVERNIGHT_START_HOUR + OVERNIGHT_GRACE_HOUR;

export const FLAG_FORGOT = 'Not signed out';
export const FLAG_GAP = 'Phone time was more than 10 minutes out';
export const FLAG_CORRECTED = 'Corrected';
export const FLAG_LATE = 'Late sign-out';

export const LATE_SIGN_OUT_NOTICE = 'Your shift was closed at 23:59. Your sign-out time has been sent to the manager.';
export const LATE_SIGN_OUT_REASON = 'Late sign-out sent from the phone';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_MS = 30 * DAY_MS;
const FUTURE_MS = DAY_MS;

export const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export type WeekShift = {
  flags: string[];
  correction: string | null;
  reason: string | null;
};

export type WeekRow = {
  personId: string;
  personName: string;
  /** Counted hours, or a not-signed-out note. An empty day is blank. */
  days: string[];
  /** Screen and PDF lines, only for days with counted hours or a shift to check. */
  dayLines: string[];
  dayMs: number[];
  total: string;
  totalLine: string;
  checkCount: number;
  totalMs: number;
  shifts: WeekShift[];
  correctedBy: string;
  reasons: string;
};

export type HourSpan = {
  personId: string;
  personName: string;
  inAt: string;
  outAt: string | null;
  forgot: boolean;
  gap?: boolean;
  corrected?: boolean;
  late?: boolean;
  correctedBy?: string;
  reason?: string;
  /** Original state, for example "was not signed out". */
  prior?: string;
};

/** Shown once, the morning after, to the person who owns the shift. */
export const FORGOT_YESTERDAY_NOTICE = "You didn't sign out yesterday. The office will check your hours.";

function bag(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  return out;
}

/** Minutes London is ahead of UTC at this instant. */
export function londonOffsetMinutes(date: Date): number {
  const part = bag(date, LONDON);
  let hour = Number(part.hour);
  let year = Number(part.year);
  let month = Number(part.month);
  let day = Number(part.day);
  if (hour === 24) {
    hour = 0;
    const rolled = new Date(Date.UTC(year, month - 1, day + 1));
    year = rolled.getUTCFullYear();
    month = rolled.getUTCMonth() + 1;
    day = rolled.getUTCDate();
  }
  const asUtc = Date.UTC(year, month - 1, day, hour, Number(part.minute), Number(part.second));
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function londonDateKey(iso: string): string {
  const date = new Date(iso);
  const part = bag(date, LONDON);
  return `${part.year}-${part.month}-${part.day}`;
}

export function addDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map((value) => Number(value));
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, '0');
  const d = String(next.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** A Europe/London wall time as a UTC instant. 23:59 exists on both clock-change days. */
export function londonWallMs(dayKey: string, hour: number, minute: number): number {
  const [year, month, day] = dayKey.split('-').map((value) => Number(value));
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let step = 0; step < 4; step += 1) {
    const next = Date.UTC(year, month - 1, day, hour, minute, 0) - londonOffsetMinutes(new Date(utc)) * 60000;
    if (next === utc) return utc;
    utc = next;
  }
  return utc;
}

export function londonWallIso(dayKey: string, hour: number, minute: number): string {
  return new Date(londonWallMs(dayKey, hour, minute)).toISOString();
}

export function londonDayStartMs(dayKey: string): number {
  return londonWallMs(dayKey, 0, 0);
}

export function londonDayEndMs(dayKey: string): number {
  return londonWallMs(addDays(dayKey, 1), 0, 0);
}

/** 23:59 Europe/London on the sign-in day. */
export function londonCloseIso(inAt: string): string {
  const day = londonDateKey(inAt);
  const end = londonWallMs(day, 23, 59);
  const start = new Date(inAt).getTime();
  return new Date(Math.max(end, start)).toISOString();
}

export function clockGap(deviceIso: string, receivedIso: string): boolean {
  const device = new Date(deviceIso).getTime();
  const received = new Date(receivedIso).getTime();
  if (Number.isNaN(device) || Number.isNaN(received)) return true;
  return Math.abs(device - received) > CLOCK_GAP_MS;
}

export function assertDeviceTime(deviceIso: string, receivedMs: number): string {
  const at = new Date(deviceIso).getTime();
  if (Number.isNaN(at) || at > receivedMs + FUTURE_MS || at < receivedMs - PAST_MS) {
    throw new Error('invalid_time');
  }
  return new Date(at).toISOString();
}

function londonMinutes(iso: string): number {
  const part = bag(new Date(iso), LONDON);
  let hour = Number(part.hour);
  if (hour === 24) hour = 0;
  return hour * 60 + Number(part.minute);
}

const HOLD_MS = OVERNIGHT_HOLD_HOURS * 60 * 60 * 1000;

/** Evening start, still inside the hold. This is the shift a late sign-out may attach to. */
export function graceCouldOwn(inAt: string, nowIso: string): boolean {
  const start = new Date(inAt).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(now)) return false;
  return londonMinutes(inAt) >= OVERNIGHT_START_HOUR * 60 && now >= start && now - start < HOLD_MS;
}

/** The open shift is still inside the morning grace, so it is not closed yet. */
export function graceHolds(inAt: string, nowIso: string): boolean {
  if (!graceCouldOwn(inAt, nowIso)) return false;
  const graceEnds = londonWallMs(addDays(londonDateKey(inAt), 1), OVERNIGHT_GRACE_HOUR, 0);
  return new Date(nowIso).getTime() < graceEnds;
}

/**
 * A previous London day closes at 23:59 that day unless the shift is still
 * inside the overnight grace. The same input twice stays closed at that instant.
 */
export function forgottenClose(inAt: string, outAt: string | null, nowIso: string): { outAt: string; forgot: boolean } | null {
  if (outAt) return null;
  const inDay = londonDateKey(inAt);
  if (inDay >= londonDateKey(nowIso)) return null;
  if (graceHolds(inAt, nowIso)) return null;
  return { outAt: londonCloseIso(inAt), forgot: true };
}

/** Drop the seconds before any hours are added together. */
export function floorMinuteMs(ms: number): number {
  if (ms <= 0) return 0;
  return Math.floor(ms / 60000) * 60000;
}

export function formatHours(ms: number): string {
  const minutes = Math.floor(floorMinuteMs(ms) / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, '0')}m`;
}

export function decimalHours(ms: number): string {
  return (floorMinuteMs(ms) / 3600000).toFixed(2);
}

/** 8:00am in Europe/London. */
export function londonTimeLabel(iso: string): string {
  const part = bag(new Date(iso), LONDON);
  let hour = Number(part.hour);
  if (hour === 24) hour = 0;
  const suffix = hour < 12 ? 'am' : 'pm';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${part.minute}${suffix}`;
}

export function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, '');
}

export function priorPhrase(forgot: boolean, late: boolean): string {
  if (late) return 'was a late sign-out';
  if (forgot) return 'was not signed out';
  return 'was signed out';
}

export function correctionSentence(name: string, prior: string): string {
  return `Corrected by ${name}: ${prior}`;
}

export function totalLine(hours: string, checkCount: number): string {
  if (checkCount <= 0) return `Total ${hours}`;
  const noun = checkCount === 1 ? 'shift' : 'shifts';
  return `Total ${hours} + ${checkCount} ${noun} to check`;
}

export function forgotYesterday(
  entries: { entryId: string; personId: string; inAt: string; forgot: boolean; corrected: boolean }[],
  nowIso: string,
  personId: string,
  seen: ReadonlySet<string>
): { entryId: string; message: string } | null {
  const yesterday = addDays(londonDateKey(nowIso), -1);
  const hit = entries.find(
    (entry) =>
      entry.personId === personId &&
      entry.forgot &&
      !entry.corrected &&
      !seen.has(entry.entryId) &&
      londonDateKey(entry.inAt) === yesterday
  );
  return hit ? { entryId: hit.entryId, message: FORGOT_YESTERDAY_NOTICE } : null;
}

/** The yesterday line goes once they have a sign-in today. */
export function forgotLineForVisit(
  entries: { entryId: string; personId: string; inAt: string; forgot: boolean; corrected: boolean }[],
  nowIso: string,
  personId: string,
  seen: ReadonlySet<string>,
  signedInToday: boolean
): { entryId: string; message: string } | null {
  if (signedInToday) return null;
  return forgotYesterday(entries, nowIso, personId, seen);
}

export function clientNowIso(): string {
  if (process.env.EXPO_PUBLIC_USE_FIXTURES === '1') {
    const pinned = (globalThis as { __SITEPACK_NOW?: string }).__SITEPACK_NOW;
    if (typeof pinned === 'string' && pinned.length > 0) return pinned;
  }
  return new Date().toISOString();
}

export function isMondayKey(dayKey: string): boolean {
  const [year, month, day] = dayKey.split('-').map((value) => Number(value));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 1;
}

export function londonWeekStart(iso: string): string {
  const key = londonDateKey(iso);
  const [year, month, day] = key.split('-').map((value) => Number(value));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const fromMonday = weekday === 0 ? 6 : weekday - 1;
  return addDays(key, -fromMonday);
}

export function shiftWeek(weekStart: string, weeks: number): string {
  return addDays(weekStart, weeks * 7);
}

function overlapMs(start: number, end: number, dayStart: number, dayEnd: number): number {
  return Math.max(0, Math.min(end, dayEnd) - Math.max(start, dayStart));
}

export function hoursOnLondonDay(inAt: string, outAt: string, dayKey: string): number {
  const start = new Date(inAt).getTime();
  const end = new Date(outAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return overlapMs(start, end, londonDayStartMs(dayKey), londonDayEndMs(dayKey));
}

function resolvedOut(span: HourSpan, nowIso: string): { outAt: string; forgot: boolean } {
  const closed = forgottenClose(span.inAt, span.outAt, nowIso);
  if (closed) return closed;
  if (span.outAt) return { outAt: span.outAt, forgot: span.forgot };
  return { outAt: nowIso, forgot: false };
}

function weekdayName(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map((value) => Number(value));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const index = weekday === 0 ? 6 : weekday - 1;
  return WEEK_DAYS[index] ?? '';
}

/** A corrected shift counts. An uncorrected not-signed-out shift does not. */
export function describeShift(span: HourSpan, forgot: boolean): WeekShift & { counts: boolean } {
  const correction =
    span.corrected && span.correctedBy && span.prior ? correctionSentence(span.correctedBy, span.prior) : null;
  const flags: string[] = [];
  if (forgot && !correction) flags.push(FLAG_FORGOT);
  if (span.gap) flags.push(FLAG_GAP);
  if (span.late && !correction) flags.push(FLAG_LATE);
  if (span.corrected && !correction) flags.push(FLAG_CORRECTED);
  return {
    flags,
    correction,
    reason: correction ? span.reason?.trim() || null : null,
    counts: !(forgot && !span.corrected),
  };
}

export function buildWeekSheet(spans: HourSpan[], weekStart: string, nowIso: string): WeekRow[] {
  const days = WEEK_DAYS.map((_, index) => addDays(weekStart, index));
  const byPerson = new Map<string, WeekRow & { notes: string[][] }>();
  for (const span of spans) {
    const resolved = resolvedOut(span, nowIso);
    let row = byPerson.get(span.personId);
    if (!row) {
      row = {
        personId: span.personId,
        personName: span.personName,
        days: days.map(() => ''),
        dayLines: [],
        dayMs: days.map(() => 0),
        total: formatHours(0),
        totalLine: totalLine(formatHours(0), 0),
        checkCount: 0,
        totalMs: 0,
        shifts: [],
        correctedBy: '',
        reasons: '',
        notes: days.map(() => []),
      };
      byPerson.set(span.personId, row);
    }
    const described = describeShift(span, resolved.forgot || span.forgot);
    row.shifts.push({ flags: described.flags, correction: described.correction, reason: described.reason });
    if (described.correction && span.correctedBy) {
      row.correctedBy = row.correctedBy ? `${row.correctedBy}; ${span.correctedBy}` : span.correctedBy;
      if (described.reason) row.reasons = row.reasons ? `${row.reasons}; ${described.reason}` : described.reason;
    }
    if (!described.counts) {
      row.checkCount += 1;
      const index = days.indexOf(londonDateKey(span.inAt));
      if (index >= 0) row.notes[index]?.push(`not signed out (in ${londonTimeLabel(span.inAt)})`);
      continue;
    }
    days.forEach((day, index) => {
      const ms = floorMinuteMs(hoursOnLondonDay(span.inAt, resolved.outAt, day));
      row.dayMs[index] = (row.dayMs[index] ?? 0) + ms;
    });
  }
  const rows = [...byPerson.values()];
  for (const row of rows) {
    row.totalMs = row.dayMs.reduce((sum, ms) => sum + ms, 0);
    row.total = formatHours(row.totalMs);
    row.totalLine = totalLine(row.total, row.checkCount);
    row.dayLines = [];
    row.days = days.map((day, index) => {
      const name = weekdayName(day);
      const hours = (row.dayMs[index] ?? 0) > 0 ? formatHours(row.dayMs[index] ?? 0) : '';
      const notes = row.notes[index] ?? [];
      if (hours) row.dayLines.push(`${name}: ${hours}`);
      for (const note of notes) row.dayLines.push(`${name}: ${note}`);
      return [hours, ...notes].filter(Boolean).join('; ');
    });
  }
  rows.sort((a, b) => a.personName.localeCompare(b.personName, 'en-GB') || a.personId.localeCompare(b.personId));
  return rows.map(({ notes: _notes, ...row }) => row);
}

function csvCell(value: string): string {
  let text = value.replace(/[\u0085\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f]/g, ' ');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rowFlags(row: WeekRow): string {
  const seen: string[] = [];
  for (const shift of row.shifts) {
    for (const flag of shift.flags) {
      if (!seen.includes(flag)) seen.push(flag);
    }
  }
  return seen.join('; ');
}

function csvDecimal(row: WeekRow): string {
  if (row.totalMs === 0 && row.checkCount > 0) return '';
  return decimalHours(row.totalMs);
}

function csvTotal(row: WeekRow): string {
  if (row.checkCount <= 0) return row.total;
  const noun = row.checkCount === 1 ? 'shift' : 'shifts';
  return `${row.total} + ${row.checkCount} ${noun} to check`;
}

export function weekCsv(rows: WeekRow[], siteName: string, weekStart: string): string {
  const header = ['Site', 'Week', 'Person', ...WEEK_DAYS, 'Total', 'Decimal hours', 'Flags', 'Corrected by', 'Reason'];
  const lines = rows.map((row) =>
    [siteName, weekStart, row.personName, ...row.days, csvTotal(row), csvDecimal(row), rowFlags(row), row.correctedBy, row.reasons]
      .map(csvCell)
      .join(',')
  );
  return [header.map(csvCell).join(','), ...lines].join('\n');
}

export function weekRangeLabel(weekStart: string): string {
  return `${formatDate(weekStart)} to ${formatDate(addDays(weekStart, 6))}`;
}

export function preparedLine(iso: string): string {
  return `Prepared ${formatUkDateTime(iso)}`;
}

/** `YYYY-MM-DD HH:mm` or `YYYY-MM-DDTHH:mm` in Europe/London. */
export function parseLondonLocal(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error('invalid_input');
  const day = match[1] ?? '';
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) throw new Error('invalid_input');
  return londonWallIso(day, hour, minute);
}

export function londonLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const part = bag(date, LONDON);
  const hour = part.hour === '24' ? '00' : part.hour;
  return `${part.year}-${part.month}-${part.day} ${hour}:${part.minute}`;
}
