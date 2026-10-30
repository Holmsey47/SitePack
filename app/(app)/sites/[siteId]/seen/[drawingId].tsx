import { Muted, Screen } from '@/components/ui';
import { notSeenYetHeading, personLabel, seenCountLabel, sheetLabel } from '@/data/drawingSeen';
import { repo } from '@/data/index';
import type { DrawingRoster } from '@/data/drawingSeen';
import { formatUkDateTime } from '@/lib/format';
import { friendlyNetworkMessage } from '@/lib/offlineCopy';
import { textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useRefetchOnReconnect } from '@/hooks/useRefetchOnReconnect';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

export default function DrawingSeenScreen() {
  const { drawingId } = useLocalSearchParams<{ drawingId: string }>();
  const [roster, setRoster] = useState<DrawingRoster | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!drawingId) return;
    try {
      setRoster(await repo.drawingSeenRoster(drawingId));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load who has seen this.');
    }
  }, [drawingId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load who has seen this.'));
    }, [load])
  );
  useRefetchOnReconnect(load);

  const unseenHeading = roster ? notSeenYetHeading(roster.unseen.length) : '';

  return (
    <Screen>
      {roster ? (
        <Muted>
          {sheetLabel(roster)} rev {roster.revision}
        </Muted>
      ) : null}
      {roster ? (
        <Text style={{ ...textStyle.bodyStrong }}>
          {seenCountLabel(roster.seen_count, roster.assigned_count)}
        </Text>
      ) : null}
      {error ? <Text style={{ color: theme.danger }}>{friendlyNetworkMessage(error)}</Text> : null}
      {roster ? (
        <View style={{ gap: 8 }}>
          <Text style={{ ...textStyle.title }} accessibilityRole="header">
            {unseenHeading}
          </Text>
          {roster.unseen.length === 0 ? <Muted>Everyone assigned has seen it.</Muted> : null}
          {roster.unseen.map((person) => (
            <View key={person.person_id} style={{ minHeight: 48, justifyContent: 'center' }}>
              <Text style={{ ...textStyle.bodyStrong }}>{personLabel(person.display_name)}</Text>
            </View>
          ))}
          <Text style={{ ...textStyle.bodyStrong }} accessibilityRole="header">
            Seen
          </Text>
          {roster.seen.length === 0 ? <Muted>No one has seen this rev.</Muted> : null}
          {roster.seen.map((person) => (
            <View key={person.person_id} style={{ minHeight: 48, justifyContent: 'center', gap: 4 }}>
              <Text style={{ ...textStyle.bodyStrong }}>{personLabel(person.display_name)}</Text>
              <Muted>{formatUkDateTime(person.seen_at)}</Muted>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
