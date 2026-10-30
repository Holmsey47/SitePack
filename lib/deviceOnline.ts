import { subscribeOnline, type NetInfoSubscription } from '@/lib/onlineSignal';
import * as Network from 'expo-network';
import { Platform } from 'react-native';

/**
 * Native reconnect uses NetInfo through Expo Network.
 * Web uses window 'online'. React Native's window has no DOM events.
 */
export function subscribeDeviceOnline(handlers: { onOnline: () => void; onOffline: () => void }): () => void {
  if (Platform.OS === 'web') {
    const target = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
    return subscribeOnline('web', handlers, { windowTarget: target });
  }
  const NetInfo = expoNetInfo();
  return subscribeOnline('native', handlers, { netInfo: NetInfo });
}

function expoNetInfo(): NetInfoSubscription {
  return {
    addEventListener(listener) {
      const subscription = Network.addNetworkStateListener((state) => {
        const connected = state.isConnected !== false && state.isInternetReachable !== false;
        listener({ isConnected: connected });
      });
      return () => subscription.remove();
    },
  };
}
