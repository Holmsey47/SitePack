import { newId } from '@/data/newId';

const KEY = 'sitepack.talk.session';

/** Stable id for this phone. Stored with the signature so a shared device can be marked. */
export function talkSessionId(): string {
  try {
    const existing = globalThis.localStorage?.getItem(KEY);
    if (existing && existing.length >= 8) return existing;
    const next = newId();
    globalThis.localStorage?.setItem(KEY, next);
    return next;
  } catch {
    return newId();
  }
}
