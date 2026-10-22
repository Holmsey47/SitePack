const LONDON = 'Europe/London';

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'Never updated';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Updated —';
  return `Updated ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: LONDON })}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'No date';
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: LONDON });
}

type LondonClock = {
  key: string;
  weekday: string;
  day: string;
  month: string;
  time: string;
};

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? '';
}

/** Wall clock in Europe/London. Hour is 1–12 with no leading zero, minutes always two digits, am/pm lower case. */
function londonClock(date: Date): LondonClock {
  const words = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(date);
  const ymd = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour24raw = Number(part(timeParts, 'hour'));
  const hour24 = hour24raw === 24 ? 0 : hour24raw;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minute = part(timeParts, 'minute').padStart(2, '0');
  return {
    key: `${part(ymd, 'year')}-${part(ymd, 'month')}-${part(ymd, 'day')}`,
    weekday: part(words, 'weekday').replace(/\.$/, ''),
    day: part(words, 'day'),
    month: part(words, 'month').replace(/\.$/, ''),
    time: `${hour12}:${minute}${hour24 < 12 ? 'am' : 'pm'}`,
  };
}

function nextLondonKey(key: string): string {
  const [year, month, day] = key.split('-').map((value) => Number(value));
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, '0');
  const d = String(next.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Join-code expiry in London time.
 * Today and tomorrow name the day. Later dates use a short weekday.
 * A time that has already arrived is Ended.
 */
export function formatCodeExpiry(expiresAt: string, now: Date | string | number = new Date()): string {
  const expiry = new Date(expiresAt);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(expiry.getTime()) || Number.isNaN(current.getTime()) || expiry.getTime() <= current.getTime()) {
    return 'Ended';
  }
  const end = londonClock(expiry);
  const today = londonClock(current);
  if (end.key === today.key) return `Ends today ${end.time}`;
  if (end.key === nextLondonKey(today.key)) return `Ends tomorrow ${end.time}`;
  return `Ends ${end.weekday} ${end.day} ${end.month}, ${end.time}`;
}

/** UK wall time for a variation PDF and a signature. Example: 22 Oct 2026, 2:05pm. */
export function formatUkDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const clock = londonClock(date);
  const year = new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, year: 'numeric' }).format(date);
  return `${clock.day} ${clock.month} ${year}, ${clock.time}`;
}

export function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const hours = Math.round(delta / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function tradeLabel(trade: string | null | undefined): string {
  if (!trade) return '';
  return trade;
}
