import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { fontFamily } from './tokens';

/** Load SitePack faces. A failure is returned and logged; it must not throw. */
export function useSitepackFonts(): [boolean, Error | null] {
  const [loaded, error] = useFonts({
    [fontFamily.regular]: require('../../assets/fonts/Inter-Regular.ttf'),
    [fontFamily.semibold]: require('../../assets/fonts/Inter-SemiBold.ttf'),
    [fontFamily.bold]: require('../../assets/fonts/Inter-Bold.ttf'),
    [fontFamily.extraBold]: require('../../assets/fonts/Inter-ExtraBold.ttf'),
    [fontFamily.symbols]: require('../../assets/fonts/MaterialSymbolsRounded.ttf'),
  });

  useEffect(() => {
    if (!error) return;
    console.warn('SitePack fonts failed to load. Continuing with the system font.', error);
  }, [error]);

  return [loaded, error];
}
