import { DrawingFrame } from '@/components/drawing-frame';
import { FixtureOfflineSwitch, FixtureReplaceRev } from '@/components/fixture-offline';
import { Button, Muted, NewRevBadge, RevBadge, Screen, OutOfDateBadge, SeenCountChip, SeenRejectNotice, Title } from '@/components/ui';
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
import { formatDate, formatUkDateTime } from '@/lib/format';
import { deviceIsOnline } from '@/lib/variationQueue';
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
  const ownerId = person?.auth_user_id ?? null;
  const router = useRouter();
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
      <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 8 }}>
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
        <FixtureOfflineSwitch />
        {drawing && confirmQueued(queuedSeen, drawing.id, drawing.revision) ? (
          <FixtureReplaceRev
            drawingId={drawing.id}
            onReplaced={() => router.replace('/sites')}
          />
        ) : null}
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
              minHeight: 56,
              borderRadius: 14,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 18,
              paddingVertical: 12,
            }}>
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800', textAlign: 'center' }}>{SAVED_ON_PHONE}</Text>
          </View>
        ) : null}
        {drawing?.is_current && proof?.seen_at && !confirmQueued(queuedSeen, drawing.id, drawing.revision) ? (
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>
            You saw rev {drawing.revision}
            {formatUkDateTime(proof.seen_at) ? ` · ${formatUkDateTime(proof.seen_at)}` : ''}
          </Text>
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
        {manage && drawing?.is_current && roster ? (
          <SeenCountChip
            seen={roster.seen_count}
            total={roster.assigned_count}
            onPress={() => router.push(`/sites/${siteId}/seen/${drawing.id}`)}
          />
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
