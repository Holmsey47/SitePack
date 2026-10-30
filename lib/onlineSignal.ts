export type OnlineHandlers = {
  onOnline: () => void;
  onOffline: () => void;
};

export type NetInfoState = {
  isConnected: boolean | null;
};

export type NetInfoSubscription = {
  addEventListener: (listener: (state: NetInfoState) => void) => () => void;
};

type WindowTarget = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  navigator?: { onLine?: boolean };
};

export type OnlineBridge = {
  windowTarget?: WindowTarget | null;
  netInfo?: NetInfoSubscription | null;
};

/**
 * Web listens for window 'online'. Native listens to NetInfo.
 * The first native reading counts: a phone that is already online flushes once.
 * A second reading while still online does not flush again.
 */
export function subscribeOnline(platform: 'web' | 'native', handlers: OnlineHandlers, bridge: OnlineBridge): () => void {
  if (platform === 'web') {
    const target = bridge.windowTarget;
    if (!target || typeof target.addEventListener !== 'function') return () => undefined;
    const onOnline = () => handlers.onOnline();
    const onOffline = () => handlers.onOffline();
    target.addEventListener('online', onOnline);
    target.addEventListener('offline', onOffline);
    if (target.navigator?.onLine !== false) handlers.onOnline();
    return () => {
      target.removeEventListener('online', onOnline);
      target.removeEventListener('offline', onOffline);
    };
  }

  const netInfo = bridge.netInfo;
  if (!netInfo) return () => undefined;
  let seen = false;
  let online = false;
  return netInfo.addEventListener((state) => {
    const next = state.isConnected === true;
    if (next && (!seen || !online)) handlers.onOnline();
    else if (!next && seen && online) handlers.onOffline();
    seen = true;
    online = next;
  });
}
