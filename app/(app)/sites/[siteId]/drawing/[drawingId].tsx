import { DrawingFrame } from '@/components/drawing-frame';
import { FixtureOfflineSwitch, FixtureReplaceRev } from '@/components/fixture-offline';
import { Icon } from '@/components/icon';
import { Button, NewRevBadge, OverflowMenu, RevBadge, Screen, SeenRejectNotice, SupersededSafetyLabel } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import {
  seenButtonLabel,
  sheetLabel,
  type DrawingProof,
  type DrawingRoster,
} from '@/data/drawingSeen';
import { displayLevel } from '@/data/folders';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { DELETE_DRAWING_CONFIRM } from '@/data/walk';
import type { Drawing } from '@/data/types';
import type { OfflinePackMeta } from '@/lib/offline';
import {
  confirmQueued,
  getDrawingSeenQueue,
  isDroppedSeenCode,
  noticesForOwner,
  ownedQueue,
  queueId,
  queueSeenTap,
  rememberRejectedTap,
  SAVED_ON_PHONE,
  type QueuedSeen,
  type SeenNotice,
} from '@/lib/drawingSeenQueue';
import { clearNoticesAfterOpen, currentRevisionAfter, flushQueuedDrawingSeen, openReplacedNotice } from '@/lib/drawingSeenSync';
import { drawingFooterLine, formatSheetDay, formatUkDateTime } from '@/lib/format';
import { deviceIsOnline } from '@/lib/variationQueue';
import { localDrawingUri, readCachedSites, readPackMeta } from '@/lib/offline';
import { drawingCopyIsStale } from '@/lib/offlinePack';
import { saveSheet } from '@/lib/saveSheet';
import { hit, space, textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function DrawingViewerScreen() {
  const { siteId, drawingId } = useLocalSearchParams<{ siteId: string; drawingId: string }>();
  const { person } = useAuth();
  const ownerId = person?.auth_user_id ?? null;
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [cachedItem, setCachedItem] = useState<OfflinePackMeta['items'][number] | null>(null);
  const [proof, setProof] = useState<DrawingProof | null>(null);
  const [roster, setRoster] = useState<DrawingRoster | null>(null);
  const [queuedSeen, setQueuedSeen] = useState<QueuedSeen[]>([]);
  const [seenNotices, setSeenNotices] = useState<SeenNotice[]>([]);
  const [openedLocal, setOpenedLocal] = useState(false);
  const [seenNote, setSeenNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  useEffect(() => {
    if (!drawingId) return;
    let cancelled = false;
    repo
      .myDrawingProof(drawingId)
      .then((next) => {
        if (!cancelled) setProof(next);
      })
      .catch(() => undefined);
    const queue = getDrawingSeenQueue();
    queue
      .list()
      .then(async (rows) => {
        if (cancelled) return;
        setQueuedSeen(ownedQueue(rows, ownerId));
        setSeenNotices(noticesForOwner(await queue.listNotices(), ownerId));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [drawingId, ownerId, retrying]);

  const manage = person ? canManageSite(person.role) : false;
  const openedCurrent = Boolean(
    drawing?.is_current && uri && (!cachedItem || cachedItem.revision === drawing.revision)
  );

  useEffect(() => {
    if (!drawing || !openedCurrent) return;
    let cancelled = false;
    async function markOpened() {
      const queue = getDrawingSeenQueue();
      const online = await deviceIsOnline();
      if (!online) {
        if (!ownerId) return;
        await queue.put({
          id: queueId('open', drawing!.id, drawing!.revision, ownerId),
          ownerId,
          kind: 'open',
          drawingId: drawing!.id,
          siteId: drawing!.site_id,
          revision: drawing!.revision,
          at: new Date().toISOString(),
        });
        if (!cancelled) {
          setOpenedLocal(true);
          setQueuedSeen(ownedQueue(await queue.list(), ownerId));
          setSeenNotices(noticesForOwner(await queue.listNotices(), ownerId));
        }
        return;
      }
      try {
        if (ownerId) await flushQueuedDrawingSeen(ownerId);
        await repo.recordDrawingOpen(drawing!.id);
        if (cancelled) return;
        setOpenedLocal(true);
        setProof(await repo.myDrawingProof(drawing!.id));
        setQueuedSeen(ownedQueue(await queue.list(), ownerId));
        setSeenNotices(noticesForOwner(await queue.listNotices(), ownerId));
      } catch (err) {
        const code = err instanceof Error ? err.message : '';
        if (code === 'not_current' || code === 'not_authorized' || code === 'drawing_not_found') {
          if (!cancelled) setSeenNotices(noticesForOwner(await queue.listNotices(), ownerId));
          return;
        }
        if (!ownerId) return;
        await queue.put({
          id: queueId('open', drawing!.id, drawing!.revision, ownerId),
          ownerId,
          kind: 'open',
          drawingId: drawing!.id,
          siteId: drawing!.site_id,
          revision: drawing!.revision,
          at: new Date().toISOString(),
        });
        if (!cancelled) {
          setOpenedLocal(true);
          setQueuedSeen(ownedQueue(await queue.list(), ownerId));
          setSeenNotices(noticesForOwner(await queue.listNotices(), ownerId));
        }
      }
    }
    void markOpened();
    return () => {
      cancelled = true;
    };
  }, [drawing, openedCurrent, ownerId]);

  useEffect(() => {
    if (!drawing?.is_current || !ownerId) return;
    if (!openedLocal && !proof?.opened) return;
    let cancelled = false;
    void clearNoticesAfterOpen(ownerId, drawing.id)
      .then(async () => {
        if (cancelled) return;
        setSeenNotices(noticesForOwner(await getDrawingSeenQueue().listNotices(), ownerId));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [drawing?.id, drawing?.is_current, ownerId, openedLocal, proof?.opened]);

  useEffect(() => {
    if (!drawingId || !manage) return;
    let cancelled = false;
    repo
      .drawingSeenRoster(drawingId)
      .then((next) => {
        if (!cancelled) setRoster(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [drawingId, manage, proof?.seen_at]);

  async function onSeen() {
    if (!drawing || !openedCurrent || confirming) return;
    if (!openedLocal && !proof?.opened) {
      setSeenNote('Open the sheet first.');
      return;
    }
    setConfirming(true);
    setSeenNote('');
    const tappedAt = new Date().toISOString();
    const queue = getDrawingSeenQueue();
    try {
      const online = await deviceIsOnline();
      if (!online) {
        if (!ownerId) return;
        const result = await queueSeenTap(queue, {
          ownerId,
          drawingId: drawing.id,
          siteId: drawing.site_id,
          revision: drawing.revision,
          at: tappedAt,
          opened: true,
        });
        if (result === 'not_opened') {
          setSeenNote('Open the sheet first.');
          return;
        }
        setQueuedSeen(ownedQueue(await queue.list(), ownerId));
        setSeenNote(SAVED_ON_PHONE);
        return;
      }
      if (ownerId) await flushQueuedDrawingSeen(ownerId);
      if (!proof?.opened) await repo.recordDrawingOpen(drawing.id);
      await repo.confirmDrawingSeen(drawing.id, tappedAt);
      setProof(await repo.myDrawingProof(drawing.id));
      setQueuedSeen(ownedQueue(await queue.list(), ownerId));
      setSeenNotices(noticesForOwner(await queue.listNotices(), ownerId));
      if (manage) setRoster(await repo.drawingSeenRoster(drawing.id));
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'not_opened') {
        setSeenNote('Open the sheet first.');
        return;
      }
      if (isDroppedSeenCode(code)) {
        if (!ownerId) return;
        const currentRevision =
          code === 'not_current'
            ? await currentRevisionAfter({ drawingId: drawing.id, siteId: drawing.site_id })
            : null;
        await rememberRejectedTap(queue, {
          ownerId,
          drawingId: drawing.id,
          siteId: drawing.site_id,
          revision: drawing.revision,
          code,
          currentRevision,
        });
        setSeenNotices(noticesForOwner(await queue.listNotices(), ownerId));
        setQueuedSeen(ownedQueue(await queue.list(), ownerId));
        return;
      }
      if (!ownerId) return;
      const result = await queueSeenTap(queue, {
        ownerId,
        drawingId: drawing.id,
        siteId: drawing.site_id,
        revision: drawing.revision,
        at: tappedAt,
        opened: openedLocal || Boolean(proof?.opened),
      });
      if (result === 'not_opened') {
        setSeenNote('Open the sheet first.');
        return;
      }
      setQueuedSeen(ownedQueue(await queue.list(), ownerId));
      setSeenNote(SAVED_ON_PHONE);
    } finally {
      setConfirming(false);
    }
  }

  async function onDelete() {
    if (!drawing || person?.role !== 'owner') return;
    setDeleting(true);
    setError('');
    try {
      await repo.deleteDrawing(drawing.id);
      router.replace(`/sites/${drawing.site_id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'storage_orphan') {
        setError('Removed for everyone. The file will be deleted the next time you open Company.');
        setConfirmDelete(false);
        setDrawing(null);
      } else {
        setError(message || 'Could not delete the drawing.');
      }
    } finally {
      setDeleting(false);
    }
  }

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
          <ActivityIndicator color={theme.text} />
        </View>
      </Screen>
    );
  }

  const canReplace = person ? canManageSite(person.role) && drawing?.is_current : false;
  const menuItems = [
    ...(uri ? [{ label: 'Download', onPress: () => void onSave() }] : []),
    ...(canReplace && drawing
      ? [{ label: 'Replace', onPress: () => router.push(`/sites/${siteId}/upload?replace=${drawing.id}`) }]
      : []),
  ];

  const statusLine =
    drawing || revision
      ? drawingFooterLine({
          current: drawing ? drawing.is_current : null,
          day: drawing ? formatSheetDay(drawing.dated) : '',
          level: drawing ? displayLevel(drawing.level) : null,
          seen:
            manage && drawing?.is_current && roster
              ? `${roster.seen_count} of ${roster.assigned_count} seen`
              : drawing?.is_current && proof?.seen_at
                ? `Seen ${formatUkDateTime(proof.seen_at)}`
                : null,
          stale,
        })
      : '';
  const openSeen = manage && drawing?.is_current && roster && siteId
    ? () => router.push(`/sites/${siteId}/seen/${drawing.id}`)
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, backgroundColor: theme.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, minHeight: hit.secondary }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={{ width: hit.secondary, height: hit.secondary, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="arrow_back" color={theme.text} />
          </Pressable>
          <View style={{ flex: 1, flexShrink: 1, gap: space.xs, paddingVertical: space.xs }}>
            <Text style={textStyle.bodyStrong} numberOfLines={2}>
              {title}
            </Text>
            {revision ? <RevBadge revision={revision} current={drawing ? drawing.is_current : true} /> : null}
          </View>
          <OverflowMenu
            title={title}
            items={[
              ...menuItems,
              ...(person?.role === 'owner' && drawing
                ? [{ label: 'Delete drawing', danger: true, onPress: () => setConfirmDelete(true) }]
                : []),
            ]}
          />
        </View>
        {drawing && drawing.is_current === false ? <SupersededSafetyLabel /> : null}
      </View>
      <View style={{ flex: 1, minHeight: 0 }}>
        {uri ? <DrawingFrame uri={uri} onError={setError} /> : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {error ? null : <ActivityIndicator color={theme.text} />}
          </View>
        )}
      </View>
      <View
        style={{
          paddingHorizontal: space.lg,
          paddingBottom: Math.max(insets.bottom, space.sm),
          backgroundColor: theme.bg,
          gap: space.sm,
        }}>
        <FixtureOfflineSwitch />
        {drawing && confirmQueued(queuedSeen, drawing.id, drawing.revision) ? (
          <FixtureReplaceRev
            drawingId={drawing.id}
            onReplaced={() => router.replace('/sites')}
          />
        ) : null}
        {drawing?.is_current && proof?.assigned && !proof.seen_at && !confirmQueued(queuedSeen, drawing.id, drawing.revision) ? (
          <NewRevBadge sheet={sheetLabel(drawing)} revision={drawing.revision} />
        ) : null}
        {seenNotices
          .filter((notice) => notice.drawingId === drawing?.id || notice.siteId === drawing?.site_id)
          .map((notice) => (
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
        {drawing && confirmQueued(queuedSeen, drawing.id, drawing.revision) ? (
          <View
            accessibilityRole="text"
            accessibilityLabel={SAVED_ON_PHONE}
            style={{
              minHeight: hit.secondary,
              borderRadius: 14,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 18,
            }}>
            <Text style={[textStyle.bodyStrong, { textAlign: 'center' }]}>{SAVED_ON_PHONE}</Text>
          </View>
        ) : null}
        {drawing?.is_current &&
        proof?.assigned !== false &&
        !proof?.seen_at &&
        !confirmQueued(queuedSeen, drawing.id, drawing.revision) ? (
          <Button
            label={seenButtonLabel(drawing.revision)}
            minHeight={56}
            loading={confirming}
            disabled={!openedCurrent || (!openedLocal && !proof?.opened)}
            onPress={() => void onSeen()}
          />
        ) : null}
        {seenNote && seenNote !== SAVED_ON_PHONE ? <Text style={{ color: theme.danger }}>{seenNote}</Text> : null}
        {person?.role === 'owner' && drawing && confirmDelete ? (
          <View style={{ gap: space.sm }}>
            <Text style={textStyle.bodyStrong}>{DELETE_DRAWING_CONFIRM}</Text>
            <Button
              label="Delete drawing"
              variant="danger"
              minHeight={48}
              loading={deleting}
              onPress={() => void onDelete()}
            />
            <Button label="Cancel" variant="ghost" minHeight={48} onPress={() => setConfirmDelete(false)} />
          </View>
        ) : null}
        {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
        {error ? <Button label="Retry" variant="secondary" onPress={() => setRetrying((value) => !value)} /> : null}
        {saveError ? <Text style={{ color: theme.danger }}>{saveError}</Text> : null}
        {statusLine && openSeen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={statusLine}
            onPress={openSeen}
            style={{ minHeight: hit.secondary, justifyContent: 'center' }}>
            <Text style={textStyle.metaStrong} numberOfLines={1}>
              {statusLine}
            </Text>
          </Pressable>
        ) : statusLine ? (
          <View accessibilityRole="text" accessibilityLabel={statusLine} style={{ minHeight: hit.secondary, justifyContent: 'center' }}>
            <Text style={textStyle.metaStrong} numberOfLines={1}>
              {statusLine}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
