import { isRawNetworkText } from '@/lib/offlineCopy';
import { fixtureForceOffline } from '@/lib/variationQueue';

type OnlineHandlers = {
  onOnline: () => void;
  onOffline: () => void;
};

type OnlineNav = { onLine?: boolean };

/** Web offline: the fixture switch counts, then the browser. Fixtures off ignores the switch. */
export function readWebOffline(nav?: OnlineNav | null): boolean {
  try {
    if (fixtureForceOffline()) return true;
  } catch {
    // Node tests have no __DEV__ binding. A fixture miss still leaves the browser reading.
  }
  try {
    const source = nav ?? globalThis.window?.navigator ?? globalThis.navigator;
    return typeof source?.onLine === 'boolean' && source.onLine === false;
  } catch {
    return false;
  }
}

function failedOffline(result: unknown, err?: unknown): boolean {
  if (result === false) return true;
  if (!err) return false;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message.length > 0 && isRawNetworkText(message);
}

/**
 * Refetch when the device moves from offline to online.
 * The callback that subscribe makes immediately is the current reading, not a reconnect.
 * An "already online" callback is not a reconnect.
 * A second online event while a load is running does not start another.
 * A load that fails with a network error leaves the screen offline for the next real online event.
 */
export function createReconnectRefetch(input: {
  load: () => Promise<unknown> | unknown;
  subscribe: (handlers: OnlineHandlers) => () => void;
  initiallyOffline?: boolean;
}): { stop: () => void; noteOffline: () => void } {
  let stopped = false;
  let inflight = false;
  let sawOffline = input.initiallyOffline === true;
  let arming = true;
  const noteOffline = () => {
    sawOffline = true;
  };
  const unsubscribe = input.subscribe({
    onOffline() {
      sawOffline = true;
    },
    onOnline() {
      // subscribe() may report "already online" before it returns. That must not clear an offline open.
      if (arming || stopped || !sawOffline) return;
      sawOffline = false;
      if (inflight) return;
      inflight = true;
      void Promise.resolve(input.load())
        .then((result) => {
          if (failedOffline(result)) noteOffline();
        })
        .catch((err: unknown) => {
          if (failedOffline(undefined, err)) noteOffline();
        })
        .finally(() => {
          inflight = false;
        });
    },
  });
  arming = false;
  return {
    stop() {
      stopped = true;
      unsubscribe();
    },
    noteOffline,
  };
}
