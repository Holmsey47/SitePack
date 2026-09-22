export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'Never updated';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Updated —';
  return `Updated ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'No date';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
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
