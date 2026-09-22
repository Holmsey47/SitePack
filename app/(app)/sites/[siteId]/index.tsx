import { Button, Card, EmptyState, Muted, RevBadge, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { Drawing, HomeSite, ManifestItem } from '@/data/types';
import { formatDate, formatWhen } from '@/lib/format';
import { downloadCurrentPack, isPackReady, readPackMeta } from '@/lib/offline';
import { theme } from '@/lib/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function SitePackScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [site, setSite] = useState<HomeSite | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [showOld, setShowOld] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!siteId) return;
    const [nextSite, nextDrawings] = await Promise.all([repo.getSite(siteId), repo.listDrawings(siteId)]);
    setSite(nextSite);
    setDrawings(nextDrawings);
    const currentIds = nextDrawings.filter((d) => d.is_current).map((d) => d.id);
    setReady(isPackReady(siteId, currentIds));
  }, [siteId]);

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load pack'));
  }, [load]);

  const current = useMemo(() => drawings.filter((d) => d.is_current), [drawings]);
  const superseded = useMemo(() => drawings.filter((d) => !d.is_current), [drawings]);
  const manage = person ? canManageSite(person.role) : false;
  const meta = siteId ? readPackMeta(siteId) : null;

  async function onDownload() {
    if (!siteId) return;
    setError('');
    setProgress('Preparing pack…');
    try {
      const manifest: ManifestItem[] = await repo.sitePackManifest(siteId);
      if (manifest.length === 0) {
        setProgress('');
        setError('No current sheets to download.');
        return;
      }
      await downloadCurrentPack(siteId, manifest, (done, total) => {
        setProgress(`Downloading ${done} of ${total}…`);
      });
      setProgress('');
      setReady(true);
    } catch (err) {
      setProgress('');
      setError(err instanceof Error ? err.message : 'Download failed — retry. Current pointer was not changed.');
    }
  }

  if (!site && !error) {
    return (
      <Screen>
        <Muted>Loading pack…</Muted>
      </Screen>
    );
  }

  if (!site) {
    return (
      <Screen>
        <EmptyState title="This site is not assigned to you." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{site.name}</Title>
      <Muted>{site.address_line ?? 'Assigned site pack'}</Muted>
      <Muted>{formatWhen(site.updated_at)} · current sheets only unless you open archive</Muted>
      {ready ? (
        <Text style={{ color: theme.sent, fontWeight: '700' }}>
          Offline ready{meta?.downloadedAt ? ` · ${formatDate(meta.downloadedAt)}` : ''}
        </Text>
      ) : (
        <Muted>Download the current pack before you lose signal.</Muted>
      )}
      {progress ? <Muted>{progress}</Muted> : null}
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}

      <Button label={ready ? 'Re-download current pack' : 'Download for offline'} onPress={() => void onDownload()} />
      <Button label="Request a drawing" variant="secondary" onPress={() => router.push(`/sites/${siteId}/request`)} />
      {manage ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label="Upload / replace" variant="secondary" onPress={() => router.push(`/sites/${siteId}/upload`)} />
          <Button label="Assigned people" variant="ghost" onPress={() => router.push(`/sites/${siteId}/assignments`)} />
        </View>
      ) : null}

      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>CURRENT</Text>
      {current.length === 0 ? (
        <EmptyState
          title="No drawings yet"
          action={
            manage ? (
              <Button label="Upload" onPress={() => router.push(`/sites/${siteId}/upload`)} />
            ) : (
              <Button label="Request drawing" onPress={() => router.push(`/sites/${siteId}/request`)} />
            )
          }
        />
      ) : (
        current.map((drawing) => (
          <Card key={drawing.id} onPress={() => router.push(`/sites/${siteId}/drawing/${drawing.id}`)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{drawing.title}</Text>
                {drawing.sheet_number ? <Muted>{drawing.sheet_number}</Muted> : null}
                <Muted>{formatDate(drawing.dated)}</Muted>
              </View>
              <RevBadge revision={drawing.revision} current />
            </View>
            <Text style={{ color: theme.current, fontWeight: '700' }}>Open current</Text>
          </Card>
        ))
      )}

      <Pressable onPress={() => setShowOld((v) => !v)} style={{ paddingVertical: 8 }}>
        <Text style={{ color: theme.superseded, fontWeight: '700' }}>
          {showOld ? 'Hide superseded' : `Show superseded / archive (${superseded.length})`}
        </Text>
        <Muted>Deliberate extra tap. These are not the default open.</Muted>
      </Pressable>
      {showOld
        ? superseded.map((drawing) => (
            <Card key={drawing.id} onPress={() => router.push(`/sites/${siteId}/drawing/${drawing.id}`)}>
              <View style={{ opacity: 0.7, gap: 4 }}>
                <Text style={{ color: theme.superseded, fontSize: 16, fontWeight: '600' }}>{drawing.title}</Text>
                <RevBadge revision={drawing.revision} current={false} />
                <Muted>Superseded · {formatDate(drawing.dated)}</Muted>
              </View>
            </Card>
          ))
        : null}
    </Screen>
  );
}
