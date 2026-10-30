import { Icon } from '@/components/icon';
import { hit, theme } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';

/**
 * Stack back control. The navigation header's default image is fetched again on
 * web and disappears with no signal. This draws arrow_back from the Material
 * Symbols font already bundled in assets/fonts.
 */
export function ShellBackButton({ tintColor, canGoBack }: { tintColor?: string; canGoBack?: boolean }) {
  const router = useRouter();
  if (!canGoBack) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={() => {
        if (router.canGoBack()) router.back();
      }}
      style={{ minWidth: hit.min, minHeight: hit.min, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="arrow_back" color={tintColor ?? theme.text} />
    </Pressable>
  );
}
