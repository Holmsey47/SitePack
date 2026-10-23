import { Card, ChoiceChip, EmptyState, Muted, NewRevBadge, RevBadge, Screen, SeenCountChip, SeenRejectNotice, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { sheetLabel, type SiteSeenSummary, type UnseenDrawing } from '@/data/drawingSeen';
import { displayFolder, displayLevel, drawingsInFolder, levelFilterLabels } from '@/data/folders';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { Drawing } from '@/data/types';
import { confirmQueued, type QueuedSeen, type SeenNotice } from '@/lib/drawingSeenQueue';
import { loadSiteSeenSummary, refreshDrawingSeen } from '@/lib/drawingSeenSync';
import { formatDate } from '@/lib/format';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

function LevelLine({ level }: { level: string | null }) {
  const label = displayLevel(level);
  if (!label) return null;
  return <Text style={{ color: theme.text, fontWeight: '800' }}>{label}</Text>;
}

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
  const { person } = useAuth();
  const manage = person ? canManageSite(person.role) : false;
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [unseen, setUnseen] = useState<UnseenDrawing[]>([]);
  const [queuedSeen, setQueuedSeen] = useState<QueuedSeen[]>([]);
  const [seenNotices, setSeenNotices] = useState<SeenNotice[]>([]);
  const [seenSummary, setSeenSummary] = useState<SiteSeenSummary | null>(null);
  const [showOld, setShowOld] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    const rows = await repo.listDrawings(siteId);
    setDrawings(rows);
    const seen = await refreshDrawingSeen(manage, person?.auth_user_id).catch(() => null);
    if (seen) {
      setUnseen(seen.unseen.filter((row) => row.site_id === siteId));
      setQueuedSeen(seen.queued.filter((row) => row.siteId === siteId));
      setSeenNotices(seen.notices.filter((row) => row.siteId === siteId));
    }
    setSeenSummary(manage ? await loadSiteSeenSummary(siteId) : null);
    setLoaded(true);
    navigation.setOptions({ title: folderName });
  }, [folderName, manage, navigation, person?.auth_user_id, siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch((err: unknown) => {
        setLoaded(true);
        setError(err instanceof Error ? err.message : 'Could not load folder');
      });
    }, [load])
  );

  useEffect(() => {
    setLevelFilter(null);
  }, [folderName]);

  const { current, superseded } = drawingsInFolder(drawings, folderName);
  const filters = levelFilterLabels(current);
  const activeLevel = filters && levelFilter && filters.includes(levelFilter) ? levelFilter : null;
  const visibleCurrent = activeLevel
    ? current.filter((drawing) => displayLevel(drawing.level) === activeLevel)
    : current;
  const archiveOnly = current.length === 0 && superseded.length > 0;

  if (!loaded && !error) {
    return (
      <Screen>
        <Muted>Loading folder…</Muted>
      </Screen>
    );
  }

  function openDrawing(drawingId: string) {
    router.push(`/sites/${siteId}/drawing/${drawingId}`);
  }

  return (
    <Screen>
      <Title>{folderName}</Title>
      {seenNotices.map((notice) => (
        <SeenRejectNotice key={notice.id} message={notice.message} />
      ))}
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
      {filters ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <ChoiceChip label="All" selected={activeLevel === null} onPress={() => setLevelFilter(null)} />
          {filters.map((level) => (
            <ChoiceChip
              key={level}
              label={level}
              selected={activeLevel === level}
              onPress={() => setLevelFilter(level)}
            />
          ))}
        </View>
      ) : null}

      {archiveOnly ? (
        superseded.map((drawing) => (
          <Card key={drawing.id} onPress={() => openDrawing(drawing.id)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: theme.archive, fontSize: 18, fontWeight: '700' }}>{drawing.title}</Text>
                {drawing.sheet_number ? <Muted>{drawing.sheet_number}</Muted> : null}
                <LevelLine level={drawing.level} />
                <Muted>Superseded · {formatDate(drawing.dated)}</Muted>
              </View>
              <RevBadge revision={drawing.revision} current={false} />
            </View>
          </Card>
        ))
      ) : (
        <>
          <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>CURRENT</Text>
          {visibleCurrent.length === 0 ? (
            <EmptyState title="No drawings in this folder" />
          ) : (
            visibleCurrent.map((drawing) => {
              const fresh = unseen.find((row) => row.drawing_id === drawing.id);
              const count = seenSummary?.drawings.find((row) => row.drawing_id === drawing.id);
              return (
                <View key={drawing.id} style={{ gap: 8 }}>
                  <Card onPress={() => openDrawing(drawing.id)}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <View style={{ flex: 1, gap: 8 }}>
                        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{drawing.title}</Text>
                        {drawing.sheet_number ? <Muted>{drawing.sheet_number}</Muted> : null}
                        <LevelLine level={drawing.level} />
                        <Muted>{formatDate(drawing.dated)}</Muted>
                        {fresh && !confirmQueued(queuedSeen, drawing.id, drawing.revision) ? (
                          <NewRevBadge sheet={sheetLabel(drawing)} revision={drawing.revision} />
                        ) : null}
                      </View>
                      <RevBadge revision={drawing.revision} current />
                    </View>
                  </Card>
                  {manage && count ? (
                    <SeenCountChip
                      seen={count.seen_count}
                      total={seenSummary?.assigned_count ?? 0}
                      onPress={() => router.push(`/sites/${siteId}/seen/${drawing.id}`)}
                    />
                  ) : null}
                </View>
              );
            })
          )}

          {!activeLevel && superseded.length > 0 ? (
            <Pressable onPress={() => setShowOld((value) => !value)} style={{ minHeight: 48, justifyContent: 'center' }}>
              <Text style={{ color: theme.superseded, fontWeight: '700' }}>
                {showOld ? 'Hide superseded' : `Show superseded / archive (${superseded.length})`}
              </Text>
            </Pressable>
          ) : null}
          {!activeLevel && showOld
            ? superseded.map((drawing) => (
                <Card key={drawing.id} onPress={() => openDrawing(drawing.id)}>
                  <View style={{ opacity: 0.7, gap: 4 }}>
                    <Text style={{ color: theme.superseded, fontSize: 16, fontWeight: '600' }}>{drawing.title}</Text>
                    {drawing.sheet_number ? <Muted>{drawing.sheet_number}</Muted> : null}
                    <LevelLine level={drawing.level} />
                    <RevBadge revision={drawing.revision} current={false} />
                    <Muted>Superseded · {formatDate(drawing.dated)}</Muted>
                  </View>
                </Card>
              ))
            : null}
        </>
      )}
    </Screen>
  );
}
