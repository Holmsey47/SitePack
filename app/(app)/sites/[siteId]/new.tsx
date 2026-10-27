import { Muted, Screen, Title } from '@/components/ui';
import { newDrawingsLine, sheetLabel } from '@/data/drawingSeen';
import type { UnseenDrawing } from '@/data/drawingSeen';
import { confirmQueued } from '@/lib/drawingSeenQueue';
import { refreshDrawingSeen } from '@/lib/drawingSeenSync';
import { textStyle, theme } from '@/lib/theme';
import { useAuth } from '@/context/AuthContext';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function NewDrawingsScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<UnseenDrawing[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const seen = await refreshDrawingSeen(false, person?.auth_user_id);
      setRows(
        seen.unseen.filter(
          (row) => row.site_id === siteId && !confirmQueued(seen.queued, row.drawing_id, row.revision)
        )
      );
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load new drawings.');
    }
  }, [person?.auth_user_id, siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load new drawings.'));
    }, [load])
  );

  const heading = newDrawingsLine(rows.length) ?? 'New drawings';

  return (
    <Screen>
      <Title>{heading}</Title>
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
      {rows.length === 0 && !error ? <Muted>Nothing new to check.</Muted> : null}
      <View style={{ gap: 8 }}>
        {rows.map((row) => {
          const label = `${sheetLabel(row)} rev ${row.revision}`;
          return (
            <Pressable
              key={row.drawing_id}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => router.push(`/sites/${siteId}/drawing/${row.drawing_id}`)}
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
              <Text style={{ ...textStyle.bodyStrong }}>{row.title}</Text>
              <Muted>{label}</Muted>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
