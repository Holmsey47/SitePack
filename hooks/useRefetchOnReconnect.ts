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

/**
 * While this screen is focused, a reconnect runs load once. Blur and unmount unsubscribe.
 * Call the returned noteOffline when this screen's own load fails with a network error
 * or shows an offline line. A browser that still says online will not count as a reconnect
 * until that happens, and the next real online event then refetches once.
 */
export function useRefetchOnReconnect(load: () => Promise<unknown> | void): () => void {
  const loadRef = useRef(load);
  loadRef.current = load;
  const pendingOffline = useRef(false);
  const noteRef = useRef<() => void>(() => {
    pendingOffline.current = true;
  });
  const noteOffline = useCallback(() => {
    noteRef.current();
  }, []);
  useFocusEffect(
    useCallback(() => {
      let stopped = false;
      let unsubscribe = () => {};
      void (async () => {
        const initiallyOffline = (await readOfflineNow()) || pendingOffline.current;
        if (stopped) return;
        const session = createReconnectRefetch({
          load: () => loadRef.current(),
          subscribe: subscribeDeviceOnline,
          initiallyOffline,
        });
        noteRef.current = session.noteOffline;
        if (pendingOffline.current) {
          pendingOffline.current = false;
          session.noteOffline();
        }
        unsubscribe = session.stop;
      })();
      return () => {
        stopped = true;
        unsubscribe();
        pendingOffline.current = false;
        noteRef.current = () => {
          pendingOffline.current = true;
        };
      };
    }, [])
  );
  return noteOffline;
}
