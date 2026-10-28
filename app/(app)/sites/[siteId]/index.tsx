import { Icon } from '@/components/icon';
import { SiteBar } from '@/components/site-bar';
import { PeoplePill, SitesBackButton } from '@/components/site-header';
import { Button, Card, EmptyState, GlanceRow, Muted, OverflowMenu, Screen, OutOfDateBadge, SectionLabel, SeenRejectNotice } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { newDrawingsLine, siteUnseenLine, type SiteSeenSummary, type UnseenDrawing } from '@/data/drawingSeen';
import { packFolders } from '@/data/folders';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { badgeReadIsCurrent, DRAWINGS_LIST_BOTTOM_PAD, type SiteListKind } from '@/data/siteListSeen';
import type { Drawing, HomeSite, ManifestItem } from '@/data/types';
import { confirmQueued, SAVED_ON_PHONE, type QueuedSeen, type SeenNotice } from '@/lib/drawingSeenQueue';
import { loadSiteSeenSummary, openReplacedNotice, refreshDrawingSeen } from '@/lib/drawingSeenSync';
import { formatDate, formatWhen } from '@/lib/format';
import { ARCHIVE_SITE_CONFIRM, PACK_DOWNLOAD_ERROR, RESTORE_SITE_CONFIRM } from '@/data/walk';
import { setDownloadBackNote } from '@/lib/backRegistry';
import { DOWNLOAD_CARRIES_ON } from '@/lib/hardwareBack';
import { showBackToast } from '@/lib/backToast';
import { downloadCurrentPack, isPackReady, readCachedSites, readPackMeta } from '@/lib/offline';
import { changedSheetCount, packIsStale, phoneCopyOutOfDateLine, phoneSheetRows } from '@/lib/offlinePack';
import { markSiteListSeen, pendingSiteListSaves, siteBarCounts } from '@/lib/siteListSeenSync';
import { space, textStyle, theme } from '@/lib/theme';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function SitePackScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const manage = person ? canManageSite(person.role) : false;
  const [allowDownloadLeave, setAllowDownloadLeave] = useState(false);
  const pendingDownloadLeave = useRef<NavigationAction | null>(null);
  const mounted = useRef(true);
  const [site, setSite] = useState<HomeSite | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [progress, setProgress] = useState<string>('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [barCounts, setBarCounts] = useState<Partial<Record<SiteListKind, number>> | null>(null);
  const countToken = useRef(0);
  const selfId = person?.id ?? null;
  const [unseen, setUnseen] = useState<UnseenDrawing[]>([]);
  const [queuedSeen, setQueuedSeen] = useState<QueuedSeen[]>([]);
  const [seenNotices, setSeenNotices] = useState<SeenNotice[]>([]);
  const [seenSummary, setSeenSummary] = useState<SiteSeenSummary | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  useLayoutEffect(() => {
    const items: { label: string; danger?: boolean; onPress: () => void }[] = [];
    if (manage && siteId) {
      items.push({
        label: 'Upload',
        onPress: () => router.push(`/sites/${siteId}/upload`),
      });
    }
    if (person?.role === 'owner' && site) {
      items.push({
        label: site.archived_at ? 'Restore site' : 'Archive site',
        danger: !site.archived_at,
        onPress: () => setConfirmArchive(true),
      });
    }
    navigation.setOptions({
      title: '',
      headerTitle: () => null,
      headerBackVisible: false,
      headerTitleContainerStyle: { width: 0, maxWidth: 0 },
      headerLeft: () => <SitesBackButton />,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {items.length > 0 ? <OverflowMenu label="Site menu" items={items} /> : null}
          {siteId ? <PeoplePill siteId={siteId} /> : null}
        </View>
      ),
    });
  }, [manage, navigation, person?.role, router, site, siteId]);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const [nextSite, nextDrawings] = await Promise.all([repo.getSite(siteId), repo.listDrawings(siteId)]);
      setSite(nextSite);
      setDrawings(nextDrawings);
      setLoaded(true);
      setError('');
      const currentIds = nextDrawings.filter((d) => d.is_current).map((d) => d.id);
      setReady(isPackReady(siteId, currentIds));
      const manageNow = person ? canManageSite(person.role) : false;
      const seen = await refreshDrawingSeen(manageNow, person?.auth_user_id).catch(() => null);
      if (seen) {
        setUnseen(seen.unseen.filter((row) => row.site_id === siteId));
        setQueuedSeen(seen.queued.filter((row) => row.siteId === siteId));
        setSeenNotices(seen.notices.filter((row) => row.siteId === siteId));
      }
      if (manageNow) setSeenSummary(await loadSiteSeenSummary(siteId));
      else setSeenSummary(null);
    } catch {
      const cached = readCachedSites().find((row) => row.id === siteId) ?? null;
      const meta = readPackMeta(siteId);
      if (!cached && !meta) {
        setError('Could not load the pack.');
        return;
      }
      setSite(
        cached ?? {
          id: siteId,
          company_id: '',
          name: 'Site',
          address_line: null,
          main_contractor: null,
          what_it_is: null,
          archived_at: null,
          created_at: meta?.downloadedAt ?? '',
          updated_at: meta?.downloadedAt ?? '',
        }
      );
      setDrawings([]);
      setLoaded(true);
      setError('');
      setReady(Boolean(meta && meta.items.length > 0));
    }
  }, [siteId, person]);

  const refreshCounts = useCallback(async () => {
    if (!siteId) return;
    const token = ++countToken.current;
    await Promise.all(pendingSiteListSaves(siteId));
    if (!badgeReadIsCurrent(token, countToken.current)) return;
    const counts = await siteBarCounts(siteId, selfId);
    if (!mounted.current || !badgeReadIsCurrent(token, countToken.current)) return;
    setBarCounts(counts);
  }, [selfId, siteId]);

  const openList = useCallback(
    (kind: SiteListKind) => {
      if (!siteId) return;
      setBarCounts((current) => ({ ...(current ?? {}), [kind]: 0 }));
      const token = ++countToken.current;
      void markSiteListSeen(siteId, kind).then(async () => {
        if (!badgeReadIsCurrent(token, countToken.current)) return;
        const counts = await siteBarCounts(siteId, selfId);
        if (!mounted.current || !badgeReadIsCurrent(token, countToken.current)) return;
        setBarCounts(counts);
      });
    },
    [selfId, siteId],
  );

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load the pack.'));
      void refreshCounts();
    }, [load, refreshCounts])
  );

  const folders = packFolders(drawings);
  const meta = siteId ? readPackMeta(siteId) : null;
  const currentSheets = drawings
    .filter((drawing) => drawing.is_current)
    .map((drawing) => ({ drawingId: drawing.id, revision: drawing.revision, title: drawing.title }));
  const phoneRows = meta
    ? phoneSheetRows(meta.items, drawings.length > 0 ? currentSheets : null)
    : [];
  const changeCount = changedSheetCount(phoneRows);
  const outOfDate = meta
    ? drawings.length > 0
      ? changeCount > 0
      : packIsStale(meta, { updatedAt: site?.updated_at })
    : false;
  const downloading = progress.length > 0;

  usePreventRemove(downloading && !allowDownloadLeave, ({ data }) => {
    pendingDownloadLeave.current = data.action;
    showBackToast(DOWNLOAD_CARRIES_ON);
    setAllowDownloadLeave(true);
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setDownloadBackNote(downloading);
    return () => setDownloadBackNote(false);
  }, [downloading]);

  useEffect(() => {
    if (!allowDownloadLeave) return;
    const action = pendingDownloadLeave.current;
    pendingDownloadLeave.current = null;
    if (action) navigation.dispatch(action);
    else router.back();
  }, [allowDownloadLeave, navigation, router]);

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
        if (mounted.current) setProgress(`Downloading ${done} of ${total}…`);
      });
      if (!mounted.current) return;
      setProgress('');
      setReady(true);
    } catch {
      if (!mounted.current) return;
      setProgress('');
      setError(PACK_DOWNLOAD_ERROR);
    }
  }

  if (!site && !loaded && !error) {
    return (
      <Screen>
        <Muted>Loading pack…</Muted>
      </Screen>
    );
  }

  if (!site) {
    return (
      <Screen>
        <EmptyState title={error ? 'Could not load the pack.' : 'This site is not assigned to you.'} />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        siteId ? <SiteBar siteId={siteId} siteName={site.name} counts={barCounts} onOpen={openList} /> : null
      }
      contentPaddingBottom={DRAWINGS_LIST_BOTTOM_PAD}>
      <Text style={textStyle.display} numberOfLines={2}>
        {site.name}
      </Text>
      {(() => {
        const unseenLine = manage && seenSummary ? siteUnseenLine(seenSummary.not_seen_by_everyone) : null;
        const meta = [site.address_line, formatWhen(site.updated_at), unseenLine].filter(Boolean).join(' · ');
        if (!meta) return null;
        if (!unseenLine) {
          return (
            <Text style={textStyle.meta} numberOfLines={2}>
              {meta}
            </Text>
          );
        }
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={meta}
            onPress={() => router.push(`/sites/${siteId}/not-seen`)}
            style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={textStyle.meta} numberOfLines={2}>
              {meta}
            </Text>
          </Pressable>
        );
      })()}
      {(() => {
        const fresh = unseen.filter((row) => !confirmQueued(queuedSeen, row.drawing_id, row.revision));
        const freshLine = manage ? null : newDrawingsLine(fresh.length);
        const waiting = queuedSeen.some((row) => row.kind === 'confirm');
        if (!freshLine && !waiting && seenNotices.length === 0) return null;
        return (
          <View style={{ gap: 8 }}>
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
            {freshLine ? <GlanceRow label={freshLine} onPress={() => router.push(`/sites/${siteId}/new`)} /> : null}
            {waiting ? <Text style={textStyle.bodyStrong}>{SAVED_ON_PHONE}</Text> : null}
          </View>
        );
      })()}
      <Card onPress={() => router.push(`/sites/${siteId}/documents`)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }}>
          <Text style={[textStyle.bodyStrong, { flex: 1 }]}>Induction & RAMS</Text>
          <Icon name="chevron_right" color={theme.muted} />
        </View>
      </Card>
      <SectionLabel>Folders</SectionLabel>
      {folders.length === 0 && phoneRows.length === 0 ? (
        <EmptyState
          icon="description"
          title="No drawings yet"
          action={
            manage ? (
              <Button label="Upload" variant="secondary" onPress={() => router.push(`/sites/${siteId}/upload`)} />
            ) : undefined
          }
        />
      ) : (
        folders.map((folder) => (
          <Card
            key={folder.name}
            onPress={() => router.push(`/sites/${siteId}/folder/${encodeURIComponent(folder.name)}`)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={[textStyle.bodyStrong, { color: folder.archive ? theme.archive : theme.text }]}>
                  {folder.name}
                </Text>
                {folder.archive ? (
                  <Text style={textStyle.metaStrong}>Archive</Text>
                ) : (
                  <Muted>
                    {folder.currentCount} current sheet{folder.currentCount === 1 ? '' : 's'}
                  </Muted>
                )}
              </View>
              <Icon name="chevron_right" color={theme.muted} />
            </View>
          </Card>
        ))
      )}
      {phoneRows.length > 0 ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <SectionLabel>On this phone</SectionLabel>
            {outOfDate ? <OutOfDateBadge /> : null}
          </View>
          {outOfDate ? (
            <Text style={[textStyle.body, { width: '100%' }]}>
              {changeCount > 0 && meta
                ? phoneCopyOutOfDateLine(changeCount, meta.downloadedAt)
                : 'Phone copy is out of date.'}
            </Text>
          ) : null}
          {outOfDate ? (
            <Button
              label="Update phone copy"
              minHeight={56}
              loading={downloading}
              onPress={() => void onDownload()}
            />
          ) : null}
          {phoneRows.map((item) => (
            <Card key={item.drawingId} onPress={() => router.push(`/sites/${siteId}/drawing/${item.drawingId}`)}>
              <Text style={textStyle.bodyStrong}>
                {item.changedLabel ?? item.title}
              </Text>
              {item.changedLabel ? null : <Muted>Rev {item.revision}</Muted>}
            </Card>
          ))}
        </View>
      ) : null}
      <Muted>Download the current pack before you lose signal.</Muted>
      {ready ? (
        <Text style={[textStyle.metaStrong, textStyle.tabular]}>
          Offline ready{meta?.downloadedAt ? ` · ${formatDate(meta.downloadedAt)}` : ''}
        </Text>
      ) : null}
      {progress ? <Muted>{progress}</Muted> : null}
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
      <Button
        label={ready ? 'Re-download current pack' : 'Download for offline'}
        variant={outOfDate ? 'secondary' : 'primary'}
        onPress={() => void onDownload()}
      />
      {person?.role === 'owner' && confirmArchive ? (
        <View style={{ gap: space.md }}>
          <Text style={textStyle.body}>
            {site.archived_at ? RESTORE_SITE_CONFIRM : ARCHIVE_SITE_CONFIRM}
          </Text>
          <Button
            label={site.archived_at ? 'Restore site' : 'Archive site'}
            variant={site.archived_at ? 'secondary' : 'danger'}
            minHeight={48}
            onPress={() => {
              void repo
                .archiveSite(site.id, !site.archived_at)
                .then(() => {
                  setConfirmArchive(false);
                  return load();
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not update the site'));
            }}
          />
          <Button label="Cancel" variant="ghost" minHeight={48} onPress={() => setConfirmArchive(false)} />
        </View>
      ) : null}
    </Screen>
  );
}
