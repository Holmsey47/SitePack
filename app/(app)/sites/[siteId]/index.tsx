import { Button, Card, EmptyState, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { packFolders } from '@/data/folders';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { Drawing, HomeSite, ManifestItem } from '@/data/types';
import { formatDate, formatWhen } from '@/lib/format';
import { PACK_DOWNLOAD_ERROR } from '@/data/walk';
import { downloadCurrentPack, isPackReady, readPackMeta } from '@/lib/offline';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

export default function SitePackScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [site, setSite] = useState<HomeSite | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
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

  useFocusEffect(
    useCallback(() => {
      load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load pack'));
    }, [load])
  );

  const folders = packFolders(drawings);
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
    } catch {
      setProgress('');
      setError(PACK_DOWNLOAD_ERROR);
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
      {site.address_line ? <Muted>{site.address_line}</Muted> : null}
      {site.main_contractor ? <Muted>Main contractor · {site.main_contractor}</Muted> : null}
      {site.what_it_is ? <Muted>{site.what_it_is}</Muted> : null}
      <Muted>{formatWhen(site.updated_at)}</Muted>
      <Muted>Download the current pack before you lose signal.</Muted>
      {ready ? (
        <Text style={{ color: theme.sent, fontWeight: '700' }}>
          Offline ready{meta?.downloadedAt ? ` · ${formatDate(meta.downloadedAt)}` : ''}
        </Text>
      ) : null}
      {progress ? <Muted>{progress}</Muted> : null}
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}

      <Button label={ready ? 'Re-download current pack' : 'Download for offline'} onPress={() => void onDownload()} />
      <Button label="Request a drawing" variant="secondary" onPress={() => router.push(`/sites/${siteId}/request`)} />
      {manage ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label="Upload" variant="secondary" onPress={() => router.push(`/sites/${siteId}/upload`)} />
          <Button label="Assigned people" variant="ghost" onPress={() => router.push(`/sites/${siteId}/assignments`)} />
        </View>
      ) : null}
      {person?.role === 'owner' ? (
        <Button
          label={site.archived_at ? 'Return to the working list' : 'Archive site'}
          variant="ghost"
          onPress={() => {
            void repo
              .archiveSite(site.id, !site.archived_at)
              .then(() => load())
              .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not update the site'));
          }}
        />
      ) : null}

      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>FOLDERS</Text>
      {folders.length === 0 ? (
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
        folders.map((folder) => (
          <Card
            key={folder.name}
            onPress={() => router.push(`/sites/${siteId}/folder/${encodeURIComponent(folder.name)}`)}>
            <Text
              style={{
                color: folder.archive ? theme.archive : theme.text,
                fontSize: 18,
                fontWeight: '700',
              }}>
              {folder.name}
            </Text>
            {folder.archive ? (
              <Text style={{ color: theme.muted, fontWeight: '700' }}>Archive</Text>
            ) : (
              <Muted>
                {folder.currentCount} current sheet{folder.currentCount === 1 ? '' : 's'}
              </Muted>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}
