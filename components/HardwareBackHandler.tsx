import { backOverlayOpen, closeBackOverlay, downloadBackActive, requestUploadBackConfirm, uploadBackActive } from '@/lib/backRegistry';
import { decideHardwareBack, EXIT_ARM_MS, PRESS_BACK_AGAIN } from '@/lib/hardwareBack';
import { showBackToast } from '@/lib/backToast';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';

/** Android hardware back. Registered after the navigator so this listener runs first. */
export function HardwareBackHandler() {
  const pathname = usePathname();
  const router = useRouter();
  const pathnameRef = useRef(pathname);
  const routerRef = useRef(router);
  const exitArmedUntil = useRef(0);
  pathnameRef.current = pathname;
  routerRef.current = router;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      let canGoBack = false;
      try {
        canGoBack = routerRef.current.canGoBack();
      } catch {
        canGoBack = false;
      }
      const now = Date.now();
      const decision = decideHardwareBack({
        overlayOpen: backOverlayOpen(),
        uploadInProgress: uploadBackActive(),
        downloadInProgress: downloadBackActive(),
        pathname: pathnameRef.current,
        canGoBack,
        now,
        exitArmedUntil: exitArmedUntil.current,
      });
      if (decision === 'close-overlay') {
        closeBackOverlay();
        return true;
      }
      if (decision === 'confirm-upload') {
        requestUploadBackConfirm();
        return true;
      }
      if (decision === 'note-download' || decision === 'go-back') {
        routerRef.current.back();
        return true;
      }
      if (decision === 'arm-exit') {
        exitArmedUntil.current = now + EXIT_ARM_MS;
        showBackToast(PRESS_BACK_AGAIN);
        return true;
      }
      if (decision === 'exit') {
        exitArmedUntil.current = 0;
        BackHandler.exitApp();
        return true;
      }
      return true;
    });
    return () => subscription.remove();
  }, [pathname]);

  return null;
}
