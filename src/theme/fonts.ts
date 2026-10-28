import { useFonts } from 'expo-font';
import { fontFamily } from './tokens';

export function useSitepackFonts() {
  return useFonts({
    [fontFamily.regular]: require('../../assets/fonts/Inter-Regular.ttf'),
    [fontFamily.semibold]: require('../../assets/fonts/Inter-SemiBold.ttf'),
    [fontFamily.bold]: require('../../assets/fonts/Inter-Bold.ttf'),
    [fontFamily.extraBold]: require('../../assets/fonts/Inter-ExtraBold.ttf'),
    [fontFamily.symbols]: require('../../assets/fonts/MaterialSymbolsRounded.ttf'),
  });
}
