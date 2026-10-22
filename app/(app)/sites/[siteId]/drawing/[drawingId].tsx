import { DrawingFrame } from '@/components/drawing-frame';
import { Button, Muted, RevBadge, Screen, OutOfDateBadge, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { displayLevel } from '@/data/folders';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { Drawing } from '@/data/types';
import type { OfflinePackMeta } from '@/lib/offline';
import { formatDate } from '@/lib/format';
import { localDrawingUri, readCachedSites, readPackMeta } from '@/lib/offline';
import { drawingCopyIsStale } from '@/lib/offlinePack';
import { saveSheet } from '@/lib/saveSheet';
import { theme } from '@/lib/theme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

export default function DrawingViewerScreen() {
  const { siteId, drawingId } = useLocalSearchParams<{ siteId: string; drawingId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [cachedItem, setCachedItem] = useState<OfflinePackMeta['items'][number] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (!siteId || !drawingId) return;
      setError('');
      const meta = readPackMeta(siteId);
      const cached = meta?.items.find((item) => item.drawingId === drawingId) ?? null;
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
        const cachedRevision = cached?.revision;
        if (local && cachedRevision === row.revision) {
          setUri(local);
          return;
        }
        setUri(await repo.getDrawingOpenUrl(row));
      } catch (err: unknown) {
        const local = await localDrawingUri(siteId, drawingId);
        if (cancelled) return;
        if (local && cached) {
          setCachedItem(cached);
          setUri(local);
          setError('');
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not open drawing');
      }
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [siteId, drawingId, retrying]);

  async function onSave() {
    if (!uri || !drawing) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveSheet(uri, `${drawing.title} Rev ${drawing.revision}.pdf`);
    } catch {
      setSaveError('Could not save the sheet.');
    } finally {
      setSaving(false);
    }
  }

  const cachedSite = siteId ? readCachedSites().find((site) => site.id === siteId) : undefined;
  const stale = drawingCopyIsStale(
    siteId ? readPackMeta(siteId) : null,
    drawingId ?? '',
    drawing ? { revision: drawing.revision } : null,
    cachedSite?.updated_at
  );
  const title = drawing?.title ?? cachedItem?.title ?? 'Drawing';
  const revision = drawing?.revision ?? cachedItem?.revision;

  if (!drawing && !cachedItem && !error) {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.current} />
        </View>
      </Screen>
    );
  }

  const canReplace = person ? canManageSite(person.role) && drawing?.is_current : false;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Title>{title}</Title>
            {stale ? <OutOfDateBadge /> : null}
          </View>
          {uri ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Download sheet"
              hitSlop={12}
              disabled={saving}
              onPress={() => void onSave()}>
              <MaterialIcons name="file-download" size={26} color={theme.current} />
            </Pressable>
          ) : null}
        </View>
        {drawing || revision ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {revision ? <RevBadge revision={revision} current={drawing ? drawing.is_current : true} /> : null}
            <Muted>
              {drawing ? (drawing.is_current ? 'Current' : 'Superseded') : 'On this phone'}
              {drawing ? ` · ${formatDate(drawing.dated)}` : ''}
            </Muted>
            {drawing && displayLevel(drawing.level) ? (
              <Text style={{ color: theme.text, fontWeight: '800' }}>{displayLevel(drawing.level)}</Text>
            ) : null}
          </View>
        ) : null}
        {canReplace && drawing ? (
          <Button
            label="Replace"
            variant="secondary"
            onPress={() => router.push(`/sites/${siteId}/upload?replace=${drawing.id}`)}
          />
        ) : null}
        {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
        {error ? <Button label="Retry" variant="secondary" onPress={() => setRetrying((value) => !value)} /> : null}
        {saveError ? <Text style={{ color: theme.danger }}>{saveError}</Text> : null}
      </View>
      {uri ? <DrawingFrame uri={uri} onError={setError} /> : null}
    </View>
  );
}
