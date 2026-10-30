import { Button, Card, EmptyState, FilterOnClear, LevelMenu, Muted, NewRevBadge, RevBadge, Screen, SectionLabel, SeenCountSlot, SeenRejectNotice, SupersededSafetyLabel } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { sheetLabel, type SiteSeenSummary, type UnseenDrawing } from '@/data/drawingSeen';
import { displayFolder, displayLevel, drawingsInFolder, levelFilterLabels } from '@/data/folders';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { Drawing } from '@/data/types';
import { confirmQueued, type QueuedSeen, type SeenNotice } from '@/lib/drawingSeenQueue';
import { loadSiteSeenSummary, openReplacedNotice, refreshDrawingSeen } from '@/lib/drawingSeenSync';
import { formatDate } from '@/lib/format';
import { textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

const OLD_REVISIONS_HIDDEN = 'Old revisions hidden. Tap All to see them.';

function SupersededCard({ drawing, onPress }: { drawing: Drawing; onPress: () => void }) {
  return (
    <Card onPress={onPress}>
      <SupersededSafetyLabel />
      <View style={{ gap: 4 }}>
        <Text style={{ ...textStyle.bodyStrong, color: theme.archive }}>{drawing.title}</Text>
        {drawing.sheet_number ? <Muted>{drawing.sheet_number}</Muted> : null}
        <LevelLine level={drawing.level} />
        <RevBadge revision={drawing.revision} current={false} />
        <Muted>{formatDate(drawing.dated)}</Muted>
      </View>
    </Card>
  );
}

function LevelLine({ level }: { level: string | null }) {
  const label = displayLevel(level);
  if (!label) return null;
  return <Text style={textStyle.metaStrong}>{label}</Text>;
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
  const [seenReady, setSeenReady] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const rows = await repo.listDrawings(siteId);
      setDrawings(rows);
      setLoaded(true);
      setError('');
      const seen = await refreshDrawingSeen(manage, person?.auth_user_id).catch(() => null);
      if (seen) {
        setUnseen(seen.unseen.filter((row) => row.site_id === siteId));
        setQueuedSeen(seen.queued.filter((row) => row.siteId === siteId));
        setSeenNotices(seen.notices.filter((row) => row.siteId === siteId));
      }
      setSeenSummary(manage ? await loadSiteSeenSummary(siteId) : null);
    } finally {
      setSeenReady(true);
    }
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
    setShowOld(false);
    setSeenReady(false);
  }, [folderName]);

  const { current, superseded } = drawingsInFolder(drawings, folderName);
  const filters = levelFilterLabels(current);
  const activeLevel = filters && levelFilter && filters.includes(levelFilter) ? levelFilter : null;
  const visibleCurrent = activeLevel
    ? current.filter((drawing) => displayLevel(drawing.level) === activeLevel)
    : current;
  const visibleSuperseded = activeLevel
    ? superseded.filter((drawing) => displayLevel(drawing.level) === activeLevel)
    : superseded;
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
      {seenNotices.map((notice) => (
        <SeenRejectNotice
          key={notice.id}
          message={notice.message}
          onPress={() => {
            void openReplacedNotice(notice).then((path) => {
              if (path) router.push(path);
            });
          }}
        />
      ))}
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
      {filters ? (
        <LevelMenu
          value={activeLevel ?? ''}
          options={[
            { value: '', label: 'All levels' },
            ...filters.map((level) => ({ value: level, label: level })),
          ]}
          onChange={(value) => setLevelFilter(value || null)}
        />
      ) : null}
      {activeLevel ? <Text style={textStyle.body}>{OLD_REVISIONS_HIDDEN}</Text> : null}
      {activeLevel ? (
        <FilterOnClear
          shown={
            archiveOnly
              ? visibleSuperseded.length
              : visibleCurrent.length + (showOld ? visibleSuperseded.length : 0)
          }
          total={archiveOnly ? superseded.length : current.length + (showOld ? superseded.length : 0)}
          noun="drawings"
          onClear={() => setLevelFilter(null)}
        />
      ) : null}
      {superseded.length > 0 && !archiveOnly ? (
        <Button
          label={showOld ? 'Hide superseded' : 'Show superseded / archive'}
          variant="secondary"
          minHeight={48}
          onPress={() => setShowOld((value) => !value)}
        />
      ) : null}

      {archiveOnly ? (
        visibleSuperseded.map((drawing) => (
          <SupersededCard key={drawing.id} drawing={drawing} onPress={() => openDrawing(drawing.id)} />
        ))
      ) : (
        <>
          <SectionLabel>Current</SectionLabel>
          {visibleCurrent.length === 0 ? (
            <EmptyState icon="description" title="No drawings in this folder" />
          ) : (
            visibleCurrent.map((drawing) => {
              const fresh = unseen.find((row) => row.drawing_id === drawing.id);
              const count = seenSummary?.drawings.find((row) => row.drawing_id === drawing.id);
              return (
                <View key={drawing.id} style={{ gap: 8 }}>
                  <Card onPress={() => openDrawing(drawing.id)}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <View style={{ flex: 1, gap: 8 }}>
                        <Text style={{ ...textStyle.bodyStrong }}>{drawing.title}</Text>
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
                  {manage ? (
                    <SeenCountSlot
                      pending={!seenReady}
                      seen={count ? count.seen_count : null}
                      total={seenSummary?.assigned_count ?? 0}
                      onPress={() => router.push(`/sites/${siteId}/seen/${drawing.id}`)}
                    />
                  ) : null}
                </View>
              );
            })
          )}

          {showOld
            ? visibleSuperseded.map((drawing) => (
                <SupersededCard key={drawing.id} drawing={drawing} onPress={() => openDrawing(drawing.id)} />
              ))
            : null}
        </>
      )}
    </Screen>
  );
}
