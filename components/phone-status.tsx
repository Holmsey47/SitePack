import { hit, radius, space, textStyle, theme } from '@/lib/theme';
import { fixtureForceOffline, setFixtureForceOffline } from '@/lib/variationQueue';
import { Text } from '@/src/theme/text';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

const fixtures = __DEV__ && process.env.EXPO_PUBLIC_USE_FIXTURES === '1';

/** An Offline banner. Nothing is shown while the phone is online. */
export function PhoneStatus() {
  const [forced, setForced] = useState(() => (fixtures ? fixtureForceOffline() : false));
  const [browserOffline, setBrowserOffline] = useState(false);

  useEffect(() => {
    if (fixtures || typeof window === 'undefined') return;
    const sync = () => setBrowserOffline(window.navigator.onLine === false);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

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
