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
