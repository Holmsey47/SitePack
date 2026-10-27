import { fontFamily, hit, textStyle, theme, typeScale } from '@/lib/theme';
import { fixtureForceOffline, setFixtureForceOffline } from '@/lib/variationQueue';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

const fixtures = __DEV__ && process.env.EXPO_PUBLIC_USE_FIXTURES === '1';

/**
 * Item 5: a small online dot. The words “Phone offline” appear only when the
 * phone is offline, so the offline state is not colour alone.
 */
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
  const label = offline ? 'Phone offline' : 'Phone online';
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: hit.min }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: offline ? theme.open : theme.online,
        }}
      />
      {offline ? (
        <Text style={{ ...textStyle.metaStrong, fontFamily: fontFamily.semibold, fontSize: typeScale.meta }}>{label}</Text>
      ) : null}
    </View>
  );

  if (!fixtures) {
    return (
      <View accessibilityRole="text" accessibilityLabel={label}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: offline }}
      accessibilityLabel={label}
      onPress={() => {
        const next = !offline;
        setFixtureForceOffline(next);
        setForced(next);
      }}>
      {body}
    </Pressable>
  );
}
