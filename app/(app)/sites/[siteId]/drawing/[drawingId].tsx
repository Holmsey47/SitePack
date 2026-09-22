import { DrawingFrame } from '@/components/drawing-frame';
import { Button, Muted, RevBadge, Screen, Title } from '@/components/ui';
import { repo } from '@/data/index';
import type { Drawing } from '@/data/types';
import { formatDate } from '@/lib/format';
import { localDrawingUri } from '@/lib/offline';
import { theme } from '@/lib/theme';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

export default function DrawingViewerScreen() {
  const { siteId, drawingId } = useLocalSearchParams<{ siteId: string; drawingId: string }>();
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (!siteId || !drawingId) return;
      setError('');
      try {
        const row = await repo.getDrawing(drawingId);
        if (cancelled) return;
        setDrawing(row);
        if (!row) {
          setError('Drawing not found.');
          return;
        }
        const local = await localDrawingUri(siteId, drawingId);
        if (cancelled) return;
        if (local) {
          setUri(local);
          return;
        }
        setUri(await repo.getDrawingOpenUrl(row));
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open drawing');
      }
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [siteId, drawingId, retrying]);

  if (!drawing && !error) {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.current} />
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 6 }}>
        <Title>{drawing?.title ?? 'Drawing'}</Title>
        {drawing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <RevBadge revision={drawing.revision} current={drawing.is_current} />
            <Muted>
              {drawing.is_current ? 'Current' : 'Superseded'} · {formatDate(drawing.dated)}
            </Muted>
          </View>
        ) : null}
        {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
        {error ? <Button label="Retry" variant="secondary" onPress={() => setRetrying((v) => !v)} /> : null}
      </View>
      {uri ? <DrawingFrame uri={uri} /> : null}
    </View>
  );
}
