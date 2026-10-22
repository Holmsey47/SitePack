import { backOverlayOpen, closeBackOverlay, requestUploadBackConfirm, uploadBackActive } from '@/lib/backRegistry';
import { decideHardwareBack } from '@/lib/hardwareBack';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';

/** Android hardware back. Registered after the navigator so this listener runs first. */
export function HardwareBackHandler() {
  const pathname = usePathname();
  const router = useRouter();
  const pathnameRef = useRef(pathname);
  const routerRef = useRef(router);
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
      const decision = decideHardwareBack({
        overlayOpen: backOverlayOpen(),
        uploadInProgress: uploadBackActive(),
        pathname: pathnameRef.current,
        canGoBack,
      });
      if (decision === 'close-overlay') {
        closeBackOverlay();
        return true;
      }
      if (decision === 'confirm-upload') {
        requestUploadBackConfirm();
        return true;
      }
      if (decision === 'go-back') {
        routerRef.current.back();
        return true;
      }
      if (decision === 'exit') {
        BackHandler.exitApp();
        return true;
      }
      return true;
    });
    return () => subscription.remove();
  }, [pathname]);

  return null;
}
