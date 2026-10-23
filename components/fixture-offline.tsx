import { theme } from '@/lib/theme';
import { fixtureForceOffline, setFixtureForceOffline } from '@/lib/variationQueue';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

const enabled = __DEV__ && process.env.EXPO_PUBLIC_USE_FIXTURES === '1';

/** Dev fixture control. Release builds drop this because the flag is off. */
export function FixtureOfflineSwitch() {
  const [offline, setOffline] = useState(() => (enabled ? fixtureForceOffline() : false));
  if (!enabled) return null;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: offline }}
      accessibilityLabel={offline ? 'Phone offline' : 'Phone online'}
      onPress={() => {
        const next = !offline;
        setFixtureForceOffline(next);
        setOffline(next);
      }}
      style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={{ color: theme.current, fontSize: 16, fontWeight: '800' }}>
        {offline ? 'Phone offline — taps stay on this phone' : 'Phone online'}
      </Text>
    </Pressable>
  );
}

/** Fixture stand-in so a queued tap can be refused as replaced without a second login. */
export function FixtureReplaceRev({
  drawingId,
  onReplaced,
}: {
  drawingId: string;
  onReplaced: (nextRevision: string) => void;
}) {
  if (!enabled) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Mark this rev replaced"
      onPress={() => {
        // Metro swaps this module for an empty stub unless the fixture flag is on.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fixtures = require('@/data/fixtureRepo') as typeof import('@/data/fixtureRepo');
        const next = fixtures.devSupersedeCurrent(drawingId);
        if (!next) return;
        setFixtureForceOffline(false);
        onReplaced(next.revision);
      }}
      style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '800' }}>Mark this rev replaced</Text>
    </Pressable>
  );
}
