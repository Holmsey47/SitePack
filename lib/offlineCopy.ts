import { loginFailureCode } from '@/lib/loginError';

/** Same voice as the sign-in offline line. Curly apostrophe, plain site English. */
export const OFFLINE_SHOWING_SAVED = 'No signal. Showing what’s saved on this phone.';

/** Nothing on this phone to show. Do not claim the screen is showing saved items. */
export const OFFLINE_COME_BACK = 'No signal. This will show when you’re back online.';

/** Snags screen when this site has no saved list and no queued snag. */
export const OFFLINE_SNAGS_LATER = 'No signal. Snags will show when you’re back online.';

/** True when the text is a raw fetch or transport error, not copy we wrote. */
export function isRawNetworkText(text: string): boolean {
  return loginFailureCode({ message: text, name: text }) === 'offline';
}

/** Saved rows may use the showing line. An empty screen must not. */
export function offlineStatusLine(saved: boolean, empty = OFFLINE_COME_BACK): string {
  return saved ? OFFLINE_SHOWING_SAVED : empty;
}

/**
 * Swap a raw fetch error for an offline line.
 * The showing line is only for a screen that is actually showing saved rows.
 */
export function friendlyNetworkMessage(text: string, saved = false): string {
  if (isRawNetworkText(text)) return offlineStatusLine(saved);
  return text;
}

/** What a screen shows. A fetch error never reaches the page as TypeError text. */
export function shownFailure(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  if (isRawNetworkText(message)) return offlineStatusLine(false);
  if (message && message !== 'unknown') return message;
  return fallback;
}
