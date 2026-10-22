export type HardwareBackAction =
  | 'close-overlay'
  | 'confirm-upload'
  | 'note-download'
  | 'go-back'
  | 'arm-exit'
  | 'exit'
  | 'stay';

/** How long the sites-list exit stays armed. Matches the Android short toast. */
export const EXIT_ARM_MS = 2000;

export const PRESS_BACK_AGAIN = 'Press back again to exit';
export const DOWNLOAD_CARRIES_ON = 'Download carries on';

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

/** Sign-in, set-password, and a join or reset link opened with nothing behind it. */
export function exitsWhenNoHistory(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (path === '/login' || path === '/(auth)/login') return true;
  if (path === '/set-password' || path === '/(auth)/set-password') return true;
  if (path === '/join' || path.startsWith('/join/')) return true;
  if (path === '/reset' || path.startsWith('/reset/')) return true;
  return false;
}

/** The site pack, not a drawing, folder, or upload underneath it. */
export function isSitePackScreen(pathname: string): boolean {
  const path = normalizePath(pathname);
  return /^\/(?:\(app\)\/)?sites\/[^/]+$/.test(path);
}

/**
 * Hardware back: close a sheet first, confirm before leaving an upload that is
 * still running, say when a pack download carries on, go back one screen.
 * The sites list asks once, then exits. Sign-in, set-password, join, and reset
 * exit when there is no history.
 */
export function decideHardwareBack(input: {
  overlayOpen: boolean;
  uploadInProgress: boolean;
  downloadInProgress: boolean;
  pathname: string;
  canGoBack: boolean;
  now: number;
  exitArmedUntil: number;
}): HardwareBackAction {
  if (input.overlayOpen) return 'close-overlay';
  if (input.uploadInProgress && isUploadScreen(input.pathname)) return 'confirm-upload';
  if (input.downloadInProgress && isSitePackScreen(input.pathname)) return 'note-download';
  if (isSitesRoot(input.pathname)) return input.now < input.exitArmedUntil ? 'exit' : 'arm-exit';
  if (input.canGoBack) return 'go-back';
  if (exitsWhenNoHistory(input.pathname)) return 'exit';
  return 'stay';
}
