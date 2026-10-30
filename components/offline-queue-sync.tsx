import { useAuth } from '@/context/AuthContext';
import { subscribeDeviceOnline } from '@/lib/deviceOnline';
import { createReconnectSync, flushDeviceQueues } from '@/lib/offlineFlush';
import { useEffect } from 'react';

/** While someone is signed in, coming back online sends the queues. Signing out stops it. */
export function OfflineQueueSync() {
  const { person } = useAuth();
  const ownerId = person?.auth_user_id ?? null;

  useEffect(() => {
    if (!ownerId) return;
    const sync = createReconnectSync({
      ownerId: () => ownerId,
      flush: (id, reason) => flushDeviceQueues(id, { releaseRetry: reason === 'online' }),
    });
    const stop = subscribeDeviceOnline({
      onOnline: () => sync.onOnline(),
      onOffline: () => sync.onOffline(),
    });
    return () => {
      stop();
      sync.stop();
    };
  }, [ownerId]);

  return null;
}
