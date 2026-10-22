import { DrawingFrame } from '@/components/drawing-frame';
import { Button, Muted, NewRevBadge, RevBadge, Screen, OutOfDateBadge, SeenCountChip, Title } from '@/components/ui';
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
  flushDrawingSeenQueue,
  getDrawingSeenQueue,
  queueId,
  queueSeenTap,
  SAVED_ON_PHONE,
  type QueuedSeen,
} from '@/lib/drawingSeenQueue';
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
    getDrawingSeenQueue()
      .list()
      .then((rows) => {
        if (!cancelled) setQueuedSeen(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [drawingId, retrying]);

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
        await queue.put({
          id: queueId('open', drawing!.id, drawing!.revision),
          kind: 'open',
          drawingId: drawing!.id,
          siteId: drawing!.site_id,
          revision: drawing!.revision,
          at: new Date().toISOString(),
        });
        if (!cancelled) {
          setOpenedLocal(true);
          setQueuedSeen(await queue.list());
        }
        return;
      }
      try {
        await flushDrawingSeenQueue(queue, {
          recordOpen: (id) => repo.recordDrawingOpen(id),
          confirm: (id) => repo.confirmDrawingSeen(id),
        });
        await repo.recordDrawingOpen(drawing!.id);
        if (cancelled) return;
        setOpenedLocal(true);
        setProof(await repo.myDrawingProof(drawing!.id));
        setQueuedSeen(await queue.list());
      } catch (err) {
        const code = err instanceof Error ? err.message : '';
        if (code === 'not_current' || code === 'not_authorized') return;
        await queue.put({
          id: queueId('open', drawing!.id, drawing!.revision),
          kind: 'open',
          drawingId: drawing!.id,
          siteId: drawing!.site_id,
          revision: drawing!.revision,
          at: new Date().toISOString(),
        });
        if (!cancelled) {
          setOpenedLocal(true);
          setQueuedSeen(await queue.list());
        }
      }
    }
    void markOpened();
    return () => {
      cancelled = true;
    };
  }, [drawing, openedCurrent]);

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
    const queue = getDrawingSeenQueue();
    try {
      const online = await deviceIsOnline();
      if (!online) {
        const result = await queueSeenTap(queue, {
          drawingId: drawing.id,
          siteId: drawing.site_id,
          revision: drawing.revision,
          at: new Date().toISOString(),
          opened: true,
        });
        if (result === 'not_opened') {
          setSeenNote('Open the sheet first.');
          return;
        }
        setQueuedSeen(await queue.list());
        setSeenNote(SAVED_ON_PHONE);
        return;
      }
      await flushDrawingSeenQueue(queue, {
        recordOpen: (id) => repo.recordDrawingOpen(id),
        confirm: (id) => repo.confirmDrawingSeen(id),
      });
      if (!proof?.opened) await repo.recordDrawingOpen(drawing.id);
      await repo.confirmDrawingSeen(drawing.id);
      setProof(await repo.myDrawingProof(drawing.id));
      setQueuedSeen(await queue.list());
      if (manage) setRoster(await repo.drawingSeenRoster(drawing.id));
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'not_opened') {
        setSeenNote('Open the sheet first.');
        return;
      }
      const result = await queueSeenTap(queue, {
        drawingId: drawing.id,
        siteId: drawing.site_id,
        revision: drawing.revision,
        at: new Date().toISOString(),
        opened: openedLocal || Boolean(proof?.opened),
      });
      if (result === 'not_opened') {
        setSeenNote('Open the sheet first.');
        return;
      }
      setQueuedSeen(await queue.list());
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
