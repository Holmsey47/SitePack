import { captureIncomingLink } from '@/lib/appLinks';

/** Native App Links only. Web keeps the address bar and strips it in the screen. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return captureIncomingLink(path);
  } catch {
    return '/';
  }
}
