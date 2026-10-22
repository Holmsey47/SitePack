import { pushBackOverlay } from '@/lib/backRegistry';
import { useEffect, useRef } from 'react';

/** While `open`, hardware back runs `close` and does not leave the screen. */
export function useBackOverlay(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    return pushBackOverlay(() => closeRef.current());
  }, [open]);
}
