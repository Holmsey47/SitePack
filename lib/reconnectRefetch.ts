import { fixtureForceOffline } from '@/lib/variationQueue';

type OnlineHandlers = {
  onOnline: () => void;
  onOffline: () => void;
};

/** Web offline: the fixture switch counts, then the browser. Fixtures off ignores the switch. */
export function readWebOffline(): boolean {
  try {
    if (fixtureForceOffline()) return true;
    const nav = globalThis.window?.navigator ?? globalThis.navigator;
    return typeof nav?.onLine === 'boolean' && nav.onLine === false;
  } catch {
    return false;
  }
}

/**
 * Refetch when the device moves from offline to online.
 * An "already online" callback is not a reconnect.
 * A second online event while a load is running does not start another.
 */
export function createReconnectRefetch(input: {
  load: () => Promise<void> | void;
  subscribe: (handlers: OnlineHandlers) => () => void;
  initiallyOffline?: boolean;
}): { stop: () => void } {
  let stopped = false;
  let inflight = false;
  let sawOffline = input.initiallyOffline === true;
  const unsubscribe = input.subscribe({
    onOffline() {
      sawOffline = true;
    },
    onOnline() {
      if (stopped || !sawOffline) return;
      sawOffline = false;
      if (inflight) return;
      inflight = true;
      void Promise.resolve(input.load())
        .catch(() => undefined)
        .finally(() => {
          inflight = false;
        });
    },
  });
  return {
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}
