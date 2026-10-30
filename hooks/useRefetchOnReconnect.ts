import { subscribeDeviceOnline } from '@/lib/deviceOnline';
import { createReconnectRefetch, readWebOffline } from '@/lib/reconnectRefetch';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';

async function readOfflineNow(): Promise<boolean> {
  if (Platform.OS === 'web') return readWebOffline();
  try {
    const network = await import('expo-network');
    const state = await network.getNetworkStateAsync();
    return state.isConnected === false || state.isInternetReachable === false;
  } catch {
    return false;
  }
}

/** While this screen is focused, a reconnect runs load once. Blur and unmount unsubscribe. */
export function useRefetchOnReconnect(load: () => Promise<void> | void) {
  const loadRef = useRef(load);
  loadRef.current = load;
  useFocusEffect(
    useCallback(() => {
      let stopped = false;
      let unsubscribe = () => {};
      void (async () => {
        const initiallyOffline = await readOfflineNow();
        if (stopped) return;
        unsubscribe = createReconnectRefetch({
          load: () => loadRef.current(),
          subscribe: subscribeDeviceOnline,
          initiallyOffline,
        }).stop;
      })();
      return () => {
        stopped = true;
        unsubscribe();
      };
    }, [])
  );
}
