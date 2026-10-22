const closers: Array<() => void> = [];

/** The top closer runs on hardware back. Call the returned function to unregister. */
export function pushBackOverlay(close: () => void): () => void {
  closers.push(close);
  return () => {
    const index = closers.lastIndexOf(close);
    if (index >= 0) closers.splice(index, 1);
  };
}

export function backOverlayOpen(): boolean {
  return closers.length > 0;
}

export function closeBackOverlay(): void {
  closers[closers.length - 1]?.();
}

let uploadActive = false;
let askLeave: (() => void) | null = null;

export function setUploadBackGuard(active: boolean, requestLeave: (() => void) | null): void {
  uploadActive = active;
  askLeave = active ? requestLeave : null;
}

export function uploadBackActive(): boolean {
  return uploadActive;
}

export function requestUploadBackConfirm(): void {
  askLeave?.();
}
