export type HardwareBackAction = 'close-overlay' | 'confirm-upload' | 'go-back' | 'exit' | 'stay';

export function normalizePath(pathname: string): string {
  const path = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '');
  return path || '/';
}

/** The signed-in home. Back exits the app only here. */
export function isSitesRoot(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === '/sites' || path === '/(app)/sites' || path === '/(app)/sites/index';
}

export function isUploadScreen(pathname: string): boolean {
  return normalizePath(pathname).endsWith('/upload');
}

/**
 * Hardware back: close a sheet first, confirm before leaving an upload that is
 * still running, go back one screen, and exit only from the sites list.
 */
export function decideHardwareBack(input: {
  overlayOpen: boolean;
  uploadInProgress: boolean;
  pathname: string;
  canGoBack: boolean;
}): HardwareBackAction {
  if (input.overlayOpen) return 'close-overlay';
  if (input.uploadInProgress && isUploadScreen(input.pathname)) return 'confirm-upload';
  if (isSitesRoot(input.pathname)) return 'exit';
  if (input.canGoBack) return 'go-back';
  return 'stay';
}
