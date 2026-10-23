/** Save button copy. The list banner keeps its own "Saved on phone, will send" line. */
export const SAVING_LABEL = 'Saving…';
export const SAVED_OFFLINE = 'Saved offline, will sync';

export type SavePhase = 'idle' | 'saving' | 'saved' | 'error';

/** The button stays off after a save. It comes back only when the save threw. */
export function saveControl(phase: SavePhase, idleLabel: string): { label: string; enabled: boolean } {
  if (phase === 'saving') return { label: SAVING_LABEL, enabled: false };
  if (phase === 'saved') return { label: SAVED_OFFLINE, enabled: false };
  return { label: idleLabel, enabled: true };
}

/** First tap wins. A second tap before React disables the button does not start another save. */
export function claimSaveTap(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseSaveTap(lock: { current: boolean }): void {
  lock.current = false;
}

type SaveGate = {
  claims: Set<string>;
  finished: Set<string>;
};

export function createSaveGate(): SaveGate {
  return { claims: new Set(), finished: new Set() };
}

type EnqueueStore<T extends { localId: string }> = {
  list(): Promise<readonly { localId: string }[]>;
  put(item: T): Promise<void>;
  remove(localId: string): Promise<void>;
};

/**
 * Enqueue once per client id.
 * A second call with that id is a no-op: in flight, already queued, or already sent this session.
 * Flush still updates rows with put. This guard is only the first save.
 */
export async function enqueueOnce<T extends { localId: string }>(
  gate: SaveGate,
  item: T,
  online: boolean,
  send: (item: T) => Promise<void>,
  queue: EnqueueStore<T>
): Promise<'sent' | 'queued'> {
  if (gate.finished.has(item.localId)) return 'sent';
  if (gate.claims.has(item.localId)) return 'queued';
  gate.claims.add(item.localId);
  try {
    if ((await queue.list()).some((row) => row.localId === item.localId)) return 'queued';
    await queue.put(item);
    if (!online) return 'queued';
    try {
      await send(item);
      await queue.remove(item.localId);
      gate.finished.add(item.localId);
      return 'sent';
    } catch {
      return 'queued';
    }
  } finally {
    gate.claims.delete(item.localId);
  }
}
