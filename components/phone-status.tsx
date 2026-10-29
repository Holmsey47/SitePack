import { hit, radius, space, textStyle, theme } from '@/lib/theme';
import { fixtureForceOffline, setFixtureForceOffline } from '@/lib/variationQueue';
import { Text } from '@/src/theme/text';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

const fixtures = __DEV__ && process.env.EXPO_PUBLIC_USE_FIXTURES === '1';

/**
 * React Native sets `window` to the global object, which has no DOM events.
 * The online/offline listener is web-only. Native draws nothing here.
 */
export function browserCanListenOnline(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.addEventListener === 'function';
}

/** An Offline banner. Nothing is shown while the phone is online, or on native. */
export function PhoneStatus() {
  const listen = browserCanListenOnline();
  const [forced, setForced] = useState(() => (fixtures ? fixtureForceOffline() : false));
  const [browserOffline, setBrowserOffline] = useState(false);

  useEffect(() => {
    if (!listen || fixtures) return;
    const sync = () => setBrowserOffline(window.navigator?.onLine === false);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [listen]);

  if (!listen) return null;

  const offline = fixtures ? forced : browserOffline;
  if (!offline) return null;

  const banner = (
    <View
      style={{
        minHeight: hit.min,
        justifyContent: 'center',
        paddingHorizontal: space.lg,
        borderRadius: radius.control,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.line,
      }}>
      <Text style={textStyle.bodyStrong}>Offline</Text>
    </View>
  );

  if (!fixtures) {
    return (
      <View accessibilityRole="text" accessibilityLabel="Offline">
        {banner}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: true }}
      accessibilityLabel="Offline"
      onPress={() => {
        setFixtureForceOffline(false);
        setForced(false);
      }}>
      {banner}
    </Pressable>
  );
}
