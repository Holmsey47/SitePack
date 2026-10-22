import { formatDate, formatUkDateTime } from '@/lib/format';

const LONDON = 'Europe/London';

/** More than 10 minutes between the phone and the server. */
export const CLOCK_GAP_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_MS = 30 * DAY_MS;
const FUTURE_MS = DAY_MS;

export const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export type WeekRow = {
  personId: string;
  personName: string;
  days: string[];
  dayMs: number[];
  total: string;
  totalMs: number;
};

export type HourSpan = {
  personId: string;
  personName: string;
  inAt: string;
  outAt: string | null;
  forgot: boolean;
};

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

/**
 * An open row from a previous London day closes at 23:59 that day.
 * The same input twice stays closed at that instant.
 */
export function forgottenClose(inAt: string, outAt: string | null, nowIso: string): { outAt: string; forgot: boolean } | null {
  if (outAt) return null;
  if (londonDateKey(inAt) >= londonDateKey(nowIso)) return null;
  return { outAt: londonCloseIso(inAt), forgot: true };
}

export function formatHours(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, '0')}m`;
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

export function buildWeekSheet(spans: HourSpan[], weekStart: string, nowIso: string): WeekRow[] {
  const days = WEEK_DAYS.map((_, index) => addDays(weekStart, index));
  const byPerson = new Map<string, WeekRow>();
  for (const span of spans) {
    const resolved = resolvedOut(span, nowIso);
    let row = byPerson.get(span.personId);
    if (!row) {
      row = {
        personId: span.personId,
        personName: span.personName,
        days: days.map(() => formatHours(0)),
        dayMs: days.map(() => 0),
        total: formatHours(0),
        totalMs: 0,
      };
      byPerson.set(span.personId, row);
    }
    days.forEach((day, index) => {
      const ms = hoursOnLondonDay(span.inAt, resolved.outAt, day);
      row.dayMs[index] = (row.dayMs[index] ?? 0) + ms;
    });
  }
  const rows = [...byPerson.values()];
  for (const row of rows) {
    row.totalMs = row.dayMs.reduce((sum, ms) => sum + ms, 0);
    row.days = row.dayMs.map((ms) => formatHours(ms));
    row.total = formatHours(row.totalMs);
  }
  rows.sort((a, b) => a.personName.localeCompare(b.personName, 'en-GB') || a.personId.localeCompare(b.personId));
  return rows;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function weekCsv(rows: WeekRow[]): string {
  const header = ['Person', ...WEEK_DAYS, 'Total'].join(',');
  const lines = rows.map((row) => [csvCell(row.personName), ...row.days, row.total].join(','));
  return [header, ...lines].join('\n');
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
