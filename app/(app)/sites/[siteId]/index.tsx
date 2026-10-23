import { InductionWarning, TalkNoticeList, TalkQuestionRow, TalkReadRow } from '@/components/TalkRows';
import { SiteSignButton } from '@/components/SiteSignButton';
import { Button, Card, EmptyState, GlanceRow, Muted, Screen, OutOfDateBadge, SeenRejectNotice, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { newDrawingsLine, siteUnseenLine, type SiteSeenSummary, type UnseenDrawing } from '@/data/drawingSeen';
import { packFolders } from '@/data/folders';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { pendingShareRequestLabel, shareRenameNote, type ShareNotice } from '@/data/sharing';
import type { TalkBadge } from '@/data/talks';
import type { Drawing, HomeSite, ManifestItem } from '@/data/types';
import { confirmQueued, SAVED_ON_PHONE, type QueuedSeen, type SeenNotice } from '@/lib/drawingSeenQueue';
import { loadSiteSeenSummary, openReplacedNotice, refreshDrawingSeen } from '@/lib/drawingSeenSync';
import { dismissTalkNotice, getTalkQueue, retryQueuedTalk, type TalkNotice } from '@/lib/talkQueue';
import { refreshTalks } from '@/lib/talkSync';
import { formatDate, formatWhen } from '@/lib/format';
import { PACK_DOWNLOAD_ERROR } from '@/data/walk';
import { setDownloadBackNote } from '@/lib/backRegistry';
import { DOWNLOAD_CARRIES_ON } from '@/lib/hardwareBack';
import { showBackToast } from '@/lib/backToast';
import { downloadCurrentPack, isPackReady, readCachedSites, readPackMeta } from '@/lib/offline';
import { changedSheetCount, packIsStale, phoneCopyOutOfDateLine, phoneSheetRows } from '@/lib/offlinePack';
import { theme } from '@/lib/theme';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';
import { Redirect, useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function SitePackScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person, signOut } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const [allowDownloadLeave, setAllowDownloadLeave] = useState(false);
  const pendingDownloadLeave = useRef<NavigationAction | null>(null);
  const mounted = useRef(true);
  const [site, setSite] = useState<HomeSite | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [progress, setProgress] = useState<string>('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [newJoiners, setNewJoiners] = useState(0);
  const [unseen, setUnseen] = useState<UnseenDrawing[]>([]);
  const [queuedSeen, setQueuedSeen] = useState<QueuedSeen[]>([]);
  const [seenNotices, setSeenNotices] = useState<SeenNotice[]>([]);
  const [seenSummary, setSeenSummary] = useState<SiteSeenSummary | null>(null);
  const [talkBadge, setTalkBadge] = useState<TalkBadge | null>(null);
  const [talkNotices, setTalkNotices] = useState<TalkNotice[]>([]);
  const [inductionNames, setInductionNames] = useState<string[]>([]);
  const [shareNotices, setShareNotices] = useState<ShareNotice[]>([]);
  const [guestShare, setGuestShare] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const [nextSite, nextDrawings] = await Promise.all([repo.getSite(siteId), repo.listDrawings(siteId)]);
      if (!nextSite) {
        const shared = await repo.mySharedSites().catch(() => []);
        if (shared.some((row) => row.site_id === siteId)) {
          setGuestShare(true);
          setLoaded(true);
          return;
        }
      }
      setSite(nextSite);
      setDrawings(nextDrawings);
      if (person && canManageSite(person.role)) {
        const joiners = await repo.listJoiners(siteId).catch(() => []);
        const week = 7 * 24 * 60 * 60 * 1000;
        setNewJoiners(
          joiners.filter((row) => !row.removed_at && Date.now() - new Date(row.joined_at).getTime() < week).length
        );
      }
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
      if (person?.auth_user_id) {
        const talks = await refreshTalks(person.auth_user_id).catch(() => null);
        setTalkBadge(talks?.badges.find((row) => row.site_id === siteId) ?? null);
        setTalkNotices(talks?.notices.filter((row) => row.siteId === siteId) ?? []);
      } else {
        setTalkBadge(null);
        setTalkNotices([]);
      }
      if (manageNow) {
        const gaps = await repo.inductionSignInGaps(siteId).catch(() => null);
        setInductionNames(gaps?.map((row) => row.person_name) ?? []);
        const asks = await repo.myShareNotices().catch(() => []);
        setShareNotices(asks.filter((row) => row.site_id === siteId));
      } else {
        setInductionNames([]);
        setShareNotices([]);
      }
    } catch {
      const cached = readCachedSites().find((row) => row.id === siteId) ?? null;
      const meta = readPackMeta(siteId);
      if (!cached && !meta) {
        const shared = await repo.mySharedSites().catch(() => []);
        if (shared.some((row) => row.site_id === siteId)) {
          setGuestShare(true);
          setLoaded(true);
          return;
        }
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

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load the pack.'));
    }, [load])
  );

  const folders = packFolders(drawings);
  const manage = person ? canManageSite(person.role) : false;
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

  if (guestShare && siteId) return <Redirect href={`/sites/${siteId}/shared`} />;

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

  if (person && site.company_id !== person.company_id) {
    return <Redirect href={`/sites/${siteId}/shared`} />;
  }

  return (
    <Screen>
      {person?.role === 'operative' ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/sites')}
            style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>← Sites</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void signOut()}
            style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>Sign out</Text>
          </Pressable>
        </View>
      ) : null}
      <Title>{site.name}</Title>
      <SiteSignButton siteId={site.id} />
      {manage ? <InductionWarning names={inductionNames} /> : null}
      <TalkNoticeList
        notices={talkNotices}
        onDismiss={(notice) => {
          void dismissTalkNotice(getTalkQueue(), notice).then(() =>
            setTalkNotices((current) => current.filter((row) => row.id !== notice.id))
          );
        }}
        onRetry={(notice) => {
          const userId = person?.auth_user_id;
          if (!notice.retryLocalId || !userId) return;
          void retryQueuedTalk(getTalkQueue(), notice.retryLocalId)
            .then(() => refreshTalks(userId))
            .then((next) => {
              setTalkBadge(next.badges.find((row) => row.site_id === siteId) ?? null);
              setTalkNotices(next.notices.filter((row) => row.siteId === siteId));
            });
        }}
      />
      <TalkReadRow
        count={talkBadge?.outstanding ?? 0}
        onPress={() => router.push(`/sites/${siteId}/talks`)}
      />
      <TalkQuestionRow
        count={talkBadge?.questions ?? 0}
        onPress={() => router.push(`/sites/${siteId}/talks`)}
      />
      <Button
        label={manage ? 'On site now' : 'My hours'}
        variant="secondary"
        minHeight={56}
        onPress={() => router.push(`/sites/${siteId}/attendance`)}
      />
      {manage && seenSummary && siteUnseenLine(seenSummary.not_seen_by_everyone) ? (
        <GlanceRow
          label={siteUnseenLine(seenSummary.not_seen_by_everyone) ?? ''}
          onPress={() => router.push(`/sites/${siteId}/not-seen`)}
        />
      ) : null}
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
            {waiting ? (
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{SAVED_ON_PHONE}</Text>
            ) : null}
          </View>
        );
      })()}
      {phoneRows.length > 0 ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>ON THIS PHONE</Text>
            {outOfDate ? <OutOfDateBadge /> : null}
          </View>
          {outOfDate ? (
            <Text style={{ color: theme.text, fontSize: 16, lineHeight: 22, width: '100%' }}>
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
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>
                {item.changedLabel ?? item.title}
              </Text>
              {item.changedLabel ? null : <Muted>Rev {item.revision}</Muted>}
            </Card>
          ))}
        </View>
      ) : null}
      {manage ? (
        <View style={{ gap: 8 }}>
          <Button
            label="Invite to this site"
            minHeight={56}
            onPress={() => router.push(`/sites/${siteId}/invite-code`)}
          />
          <Button label="Who joined" variant="secondary" onPress={() => router.push(`/sites/${siteId}/joined`)} />
          {shareNotices.map((row) => (
            <Card key={row.share_id}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{pendingShareRequestLabel(row)}</Text>
              {shareRenameNote(row) ? <Muted>{shareRenameNote(row)}</Muted> : null}
              <Button label="Review" minHeight={56} onPress={() => router.push(`/sites/${siteId}/share`)} />
            </Card>
          ))}
          <Button
            label="Share with main contractor"
            minHeight={56}
            onPress={() => router.push(`/sites/${siteId}/share`)}
          />
        </View>
      ) : null}
      {manage && newJoiners > 0 ? (
        <Text style={{ color: theme.currentInk, backgroundColor: theme.current, fontWeight: '800', alignSelf: 'flex-start', borderRadius: 8, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6 }}>
          {newJoiners === 1 ? 'New joiner' : `${newJoiners} new joiners`}
        </Text>
      ) : null}
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
      <Button label="Talks" variant="secondary" onPress={() => router.push(`/sites/${siteId}/talks`)} />
      <Button label="Variations" variant="secondary" onPress={() => router.push(`/sites/${siteId}/variations`)} />
      <Button label="Snags" variant="secondary" onPress={() => router.push(`/sites/${siteId}/snags`)} />
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
      {folders.length === 0 && phoneRows.length === 0 ? (
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
