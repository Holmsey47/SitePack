import { Muted, Screen } from '@/components/ui';
import { notSeenPersonLine, notSeenYetHeading, personLabel } from '@/data/drawingSeen';
import type { NotSeenPerson } from '@/data/drawingSeen';
import { repo } from '@/data/index';
import { textStyle, theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useLayoutEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function SiteNotSeenScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const [people, setPeople] = useState<NotSeenPerson[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      setPeople(await repo.siteNotSeen(siteId));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load who has not seen the sheets.');
    }
  }, [siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load who has not seen the sheets.'));
    }, [load])
  );

  const heading = notSeenYetHeading(people.length);
  useLayoutEffect(() => {
    navigation.setOptions({ title: heading });
  }, [heading, navigation]);

  return (
    <Screen>
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
      {people.length === 0 && !error ? <Muted>Every operative has seen the current sheets.</Muted> : null}
      <View style={{ gap: 8 }}>
        {people.map((person) => {
          const label = notSeenPersonLine(personLabel(person.display_name), person.sheets.length);
          return (
            <Pressable
              key={person.person_id}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => router.push(`/sites/${siteId}/not-seen/${person.person_id}`)}
              style={({ pressed }) => [
                {
                  minHeight: 48,
                  justifyContent: 'center',
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: theme.line,
                  backgroundColor: theme.surface,
                  paddingHorizontal: 16,
                },
                pressed && { opacity: 0.85 },
              ]}>
              <Text style={{ ...textStyle.bodyStrong }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
