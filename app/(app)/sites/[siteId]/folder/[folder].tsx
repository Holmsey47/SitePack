import { Card, EmptyState, Muted, RevBadge, Screen, Title } from '@/components/ui';
import { displayFolder, drawingsInFolder } from '@/data/folders';
import { repo } from '@/data/index';
import type { Drawing } from '@/data/types';
import { formatDate } from '@/lib/format';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

function readFolderParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : (value ?? '');
  try {
    return displayFolder(decodeURIComponent(raw));
  } catch {
    return displayFolder(raw);
  }
}

export default function FolderScreen() {
  const { siteId, folder: folderParam } = useLocalSearchParams<{ siteId: string; folder: string }>();
  const folderName = readFolderParam(folderParam);
  const router = useRouter();
  const navigation = useNavigation();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [showOld, setShowOld] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    const rows = await repo.listDrawings(siteId);
    setDrawings(rows);
    setLoaded(true);
    navigation.setOptions({ title: folderName });
  }, [folderName, navigation, siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch((err: unknown) => {
        setLoaded(true);
        setError(err instanceof Error ? err.message : 'Could not load folder');
      });
    }, [load])
  );

  const { current, superseded } = drawingsInFolder(drawings, folderName);

  if (!loaded && !error) {
    return (
      <Screen>
        <Muted>Loading folder…</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{folderName}</Title>
      <Muted>Current sheets in this folder. One tap opens the PDF.</Muted>
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}

      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>CURRENT</Text>
      {current.length === 0 ? (
        <EmptyState title="No current sheets in this folder" />
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

      {superseded.length > 0 ? (
        <Pressable onPress={() => setShowOld((value) => !value)} style={{ paddingVertical: 8 }}>
          <Text style={{ color: theme.superseded, fontWeight: '700' }}>
            {showOld ? 'Hide superseded' : `Show superseded / archive (${superseded.length})`}
          </Text>
          <Muted>Deliberate extra tap. These are not the default open.</Muted>
        </Pressable>
      ) : null}
      {showOld
        ? superseded.map((drawing) => (
            <Card key={drawing.id} onPress={() => router.push(`/sites/${siteId}/drawing/${drawing.id}`)}>
              <View style={{ opacity: 0.7, gap: 4 }}>
                <Text style={{ color: theme.superseded, fontSize: 16, fontWeight: '600' }}>{drawing.title}</Text>
                {drawing.sheet_number ? <Muted>{drawing.sheet_number}</Muted> : null}
                <RevBadge revision={drawing.revision} current={false} />
                <Muted>Superseded · {formatDate(drawing.dated)}</Muted>
              </View>
            </Card>
          ))
        : null}
    </Screen>
  );
}
