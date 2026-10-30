import { loginFailureCode } from '@/lib/loginError';

/** Same voice as the sign-in offline line. Curly apostrophe, plain site English. */
export const OFFLINE_SHOWING_SAVED = 'No signal. Showing what’s saved on this phone.';

/** True when the text is a raw fetch or transport error, not copy we wrote. */
export function isRawNetworkText(text: string): boolean {
  return loginFailureCode({ message: text, name: text }) === 'offline';
}

/** Swap a raw fetch error for the offline line. Leave every other sentence as it is. */
export function friendlyNetworkMessage(text: string): string {
  if (isRawNetworkText(text)) return OFFLINE_SHOWING_SAVED;
  return text;
}

/** What a screen shows. A fetch error never reaches the page as TypeError text. */
export function shownFailure(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : '';
  if (isRawNetworkText(message)) return OFFLINE_SHOWING_SAVED;
  if (message && message !== 'unknown') return message;
  return fallback;
}
