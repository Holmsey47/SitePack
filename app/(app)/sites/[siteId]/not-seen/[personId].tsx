import { Muted, Screen, Title } from '@/components/ui';
import { personLabel, sheetLabel } from '@/data/drawingSeen';
import type { NotSeenPerson } from '@/data/drawingSeen';
import { repo } from '@/data/index';
import { textStyle, theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function NotSeenPersonScreen() {
  const { siteId, personId } = useLocalSearchParams<{ siteId: string; personId: string }>();
  const router = useRouter();
  const [person, setPerson] = useState<NotSeenPerson | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!siteId || !personId) return;
    try {
      const rows = await repo.siteNotSeen(siteId);
      setPerson(rows.find((row) => row.person_id === personId) ?? null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load these sheets.');
    }
  }, [personId, siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load these sheets.'));
    }, [load])
  );

  const name = personLabel(person?.display_name);

  return (
    <Screen>
      <Title>{name}</Title>
      {person ? <Muted>{person.sheets.length === 1 ? '1 sheet' : `${person.sheets.length} sheets`}</Muted> : null}
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
      {person && person.sheets.length === 0 ? <Muted>Nothing left to see.</Muted> : null}
      <View style={{ gap: 8 }}>
        {person?.sheets.map((sheet) => {
          const label = `${sheetLabel(sheet)} rev ${sheet.revision}`;
          return (
            <Pressable
              key={sheet.drawing_id}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => router.push(`/sites/${siteId}/drawing/${sheet.drawing_id}`)}
              style={({ pressed }) => [
                {
                  minHeight: 48,
                  justifyContent: 'center',
                  borderRadius: 12,
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.line,
                  paddingHorizontal: 14,
                },
                pressed && { opacity: 0.85 },
              ]}>
              <Text style={{ ...textStyle.bodyStrong }}>{sheet.title}</Text>
              <Muted>{label}</Muted>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
