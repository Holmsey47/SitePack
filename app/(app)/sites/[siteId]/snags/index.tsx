import { Button, Card, EmptyState, ErrorText, FilterBar, Muted, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import {
  filterSnagDetails,
  filterSnags,
  snagError,
  snagLevels,
  snagNumber,
  type SnagLevelFilter,
  type SnagList,
  type SnagStatusFilter,
} from '@/data/snags';
import { formatUkDateTime } from '@/lib/format';
import { dataUrlBytes } from '@/lib/signaturePng';
import { buildSnagPdf, snagPdfFilename, snagReportId } from '@/lib/snagPdf';
import { runExclusive } from '@/lib/offlineFlush';
import { flushSnagQueue, getSnagQueue, noticesForOwner, ownedSnagQueue, type QueuedSnag, type SnagNotice } from '@/lib/snagQueue';
import { rememberSignAgain, SIGN_OFF_QUEUED, signOffWaitingLabel, snagDisplayText } from '@/lib/snagWording';
import { OFFLINE_SNAGS_LATER, isRawNetworkText, offlineStatusLine } from '@/lib/offlineCopy';
import { cacheSnagList, readCachedSnagList } from '@/lib/offline';
import { SAVED_ON_PHONE, deviceIsOnline, fixtureForceOffline } from '@/lib/variationQueue';
import { sendQueuedSnag } from '@/lib/sendQueuedSnag';
import { saveSheet } from '@/lib/saveSheet';
import { markSiteListSeen } from '@/lib/siteListSeenSync';
import { textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { File as PhoneFile, Paths } from 'expo-file-system';
import { useRefetchOnReconnect } from '@/hooks/useRefetchOnReconnect';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';

const STATUSES: SnagStatusFilter[] = ['All', 'Open', 'Fixed', 'Signed off'];

function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
}

async function photoBytes(url: string | null | undefined): Promise<Uint8Array | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return dataUrlBytes(url);
  const response = await fetch(url);
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

export default function SnagsScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const ownerId = person?.auth_user_id ?? null;
  const [list, setList] = useState<SnagList | null>(null);
  const [queued, setQueued] = useState<QueuedSnag[]>([]);
  const [notices, setNotices] = useState<SnagNotice[]>([]);
  const [status, setStatus] = useState<SnagStatusFilter>('All');
  const [level, setLevel] = useState<SnagLevelFilter>('All');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    const seen = markSiteListSeen(siteId, 'snags');
    const queue = getSnagQueue();
    let signInRequired = false;
    if (ownerId && (await deviceIsOnline())) {
      const flushed = await runExclusive(() =>
        flushSnagQueue(queue, (item) => sendQueuedSnag(item, undefined, queue), ownerId)
      );
      signInRequired = flushed.signInRequired;
    }
    const pending = ownedSnagQueue(await queue.list(), ownerId).filter((item) => item.siteId === siteId);
    setQueued(pending);
    setNotices(noticesForOwner(await queue.listNotices(), ownerId).filter((notice) => notice.siteId === siteId));
    const cached = readCachedSnagList(siteId);
    if (cached) setList(cached);
    try {
      // Fixtures have no network. The offline switch stands in for Chrome's failed fetch.
      if (fixtureForceOffline()) throw new TypeError('Failed to fetch');
      const next = await repo.listSnags(siteId);
      cacheSnagList(siteId, next);
      setList(next);
      if (!signInRequired) setError('');
      await seen;
    } catch (err) {
      if (!signInRequired) {
        const message = err instanceof Error ? err.message : 'unknown';
        if (isRawNetworkText(message)) {
          const shown = cached ?? readCachedSnagList(siteId);
          if (shown) setList(shown);
          const saved = (shown?.rows.length ?? 0) > 0 || pending.length > 0;
          setError(offlineStatusLine(saved, OFFLINE_SNAGS_LATER));
        } else {
          setError(snagError(message));
        }
      }
    }
    if (signInRequired) setError('Sign in again to send what is saved on this phone.');
  }, [ownerId, siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load snags.'));
    }, [load])
  );
  useRefetchOnReconnect(load);

  const rows = list ? filterSnags(list.rows, status, level) : [];
  const levels = list ? snagLevels(list.rows) : [];
  const signOffsWaiting = queued.filter((item) => item.kind === 'sign').length;

  async function dismissNotice(id: string) {
    await getSnagQueue().removeNotice(id);
    setNotices((current) => current.filter((row) => row.id !== id));
  }

  async function retryNotice(notice: SnagNotice) {
    if (!notice.retryItem || !ownerId || notice.code === 'snag_list_changed') return;
    const queue = getSnagQueue();
    await queue.put({ ...notice.retryItem, attempts: 0, retryAt: undefined });
    await queue.removeNotice(notice.id);
    if (await deviceIsOnline()) {
      await runExclusive(() => flushSnagQueue(queue, (item) => sendQueuedSnag(item, undefined, queue), ownerId));
    }
    await load();
  }

  async function signAgain(notice: SnagNotice) {
    await getSnagQueue().removeNotice(notice.id);
    setNotices((current) => current.filter((row) => row.id !== notice.id));
    if (notice.signMode === 'internal' || notice.signMode === 'contractor') {
      rememberSignAgain({
        signMode: notice.signMode,
        signerName: notice.signerName ?? '',
        signerRole: notice.signerRole ?? '',
        signerCompany: notice.signerCompany ?? '',
      });
    }
    if (siteId) router.push(`/sites/${siteId}/snags/sign`);
  }

  async function saveNoticePhotos(notice: SnagNotice) {
    for (const [index, photo] of notice.photos.entries()) {
      const name = `snag-photo-${index + 1}.jpg`;
      if (Platform.OS === 'web') {
        const blob = bytesToBlob(photo.bytes, photo.contentType || 'image/jpeg');
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        URL.revokeObjectURL(url);
        continue;
      }
      const local = new PhoneFile(Paths.cache, name);
      local.write(photo.bytes);
      await Sharing.shareAsync(local.uri, { mimeType: photo.contentType || 'image/jpeg', UTI: 'public.jpeg' });
    }
  }

  async function onShare() {
    if (!siteId) return;
    setBusy(true);
    setError('');
    try {
      const [report, company, site] = await Promise.all([repo.snagReport(siteId), repo.companyName(), repo.getSite(siteId)]);
      const picked = filterSnagDetails(report.rows, status, level);
      const generatedAt = new Date().toISOString();
      const reportId = snagReportId(generatedAt);
      const snags = [];
      for (const row of picked) {
        const photos = [];
        for (const photo of row.photos) {
          const bytes = await photoBytes(photo.signed_url);
          photos.push({ bytes, contentType: photo.content_type, kind: photo.kind });
        }
        const signaturePng = row.signature?.signature_png ? dataUrlBytes(row.signature.signature_png) : null;
        snags.push({
          snagSeq: row.snag_seq,
          note: row.note,
          levelArea: row.level_area,
          tradeLabel: row.trade_label,
          status: row.status,
          raisedByName: row.raised_by_name,
          raisedAt: row.raised_at,
          fixedAt: row.fixed_at,
          photos,
          signature: row.signature
            ? {
                signerName: row.signature.signer_name,
                signerRole: row.signature.signer_role,
                signerCompany: row.signature.signer_company,
                signedAt: row.signature.signed_at,
                signaturePng,
              }
            : null,
        });
      }
      const filterLabel = `${status === 'All' ? 'All snags' : status}${level === 'All' ? '' : ` · ${level}`}`;
      const { bytes } = await buildSnagPdf({
        reportId,
        companyName: company,
        siteName: site?.name ?? 'Site',
        generatedAt,
        filterLabel,
        snags,
      });
      const name = snagPdfFilename(reportId);
      if (Platform.OS === 'web') {
        const blob = bytesToBlob(bytes, 'application/pdf');
        const url = URL.createObjectURL(blob);
        const file = new globalThis.File([blob], name, { type: 'application/pdf' });
        const nav = navigator as Navigator & { canShare?: (data: { files?: File[] }) => boolean };
        if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
          await nav.share({ files: [file], title: name.replace(/\.pdf$/, '') });
          return;
        }
        await saveSheet(url, name);
        return;
      }
      const local = new PhoneFile(Paths.cache, name);
      local.write(bytes);
      await Sharing.shareAsync(local.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    } catch {
      setError('Could not share the snag report.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      {list ? (
        <Text style={textStyle.metaStrong}>
          {list.open_count} open · {list.fixed_count} fixed · {list.signed_off_count} signed off
        </Text>
      ) : null}
      <FilterBar
        chips={STATUSES.map((item) => ({
          key: item,
          label: item,
          selected: status === item,
          onPress: () => setStatus(item),
        }))}
        level={{
          value: level,
          options: [{ value: 'All', label: 'All levels' }, ...levels.map((item) => ({ value: item, label: item }))],
          onChange: (value) => setLevel(value as SnagLevelFilter),
        }}
        narrowed={status !== 'All' || level !== 'All'}
        shown={rows.length}
        total={list?.rows.length ?? 0}
        noun="snags"
        onClear={() => {
          setStatus('All');
          setLevel('All');
        }}
      />
      {notices.map((notice) => (
        <Card key={notice.id}>
          <Text style={{ ...textStyle.metaStrong }}>{notice.message}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {notice.photos.length > 0 ? (
              <Button label="Save photo" variant="secondary" minHeight={48} onPress={() => void saveNoticePhotos(notice)} />
            ) : null}
            {notice.code === 'snag_list_changed' ? (
              <Button label="Sign again" variant="secondary" minHeight={48} onPress={() => void signAgain(notice)} />
            ) : notice.retryItem ? (
              <Button label="Try again" variant="secondary" minHeight={48} onPress={() => void retryNotice(notice)} />
            ) : null}
            <Button label="Dismiss" variant="secondary" minHeight={48} onPress={() => void dismissNotice(notice.id)} />
          </View>
        </Card>
      ))}
      {queued.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ ...textStyle.bodyStrong, backgroundColor: theme.surface, padding: 12, borderRadius: 12 }}>
            {SAVED_ON_PHONE}
          </Text>
          {queued.map((item) => (
            <Card key={item.localId}>
              <Text style={{ ...textStyle.bodyStrong }}>
                {item.kind === 'create' ? snagDisplayText(item.note) : item.kind === 'fix' ? 'After photo waiting to send' : SIGN_OFF_QUEUED}
              </Text>
              <Muted>{item.kind === 'create' ? formatUkDateTime(item.raisedAt) : item.kind === 'fix' ? formatUkDateTime(item.fixedAt) : formatUkDateTime(item.signedAt)}</Muted>
            </Card>
          ))}
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {list && rows.length === 0 && queued.length === 0 ? (
        <EmptyState
          icon="report"
          title={list.rows.length === 0 ? 'Snags raised on this site show up here' : 'No snags in this filter'}
          action={
            list.rows.length === 0 ? (
              <Button label="Raise a snag" onPress={() => router.push(`/sites/${siteId}/snags/new`)} />
            ) : undefined
          }
        />
      ) : null}
      {rows.map((row) => (
        <Card key={row.snag_id} onPress={() => router.push(`/sites/${siteId}/snags/${row.snag_id}`)}>
          <Text style={{ ...textStyle.bodyStrong }}>
            {snagNumber(row.snag_seq)} · {row.trade_label}
          </Text>
          <Muted>
            {row.status}
            {row.level_area ? ` · ${snagDisplayText(row.level_area)}` : ''} · {snagDisplayText(row.note)}
          </Muted>
        </Card>
      ))}
      {signOffsWaiting > 0 ? (
        <Text nativeID="signoff-waiting" style={textStyle.bodyStrong}>
          {signOffWaitingLabel(signOffsWaiting)}
        </Text>
      ) : list && list.fixed_count > 0 ? (
        <Button label="Sign off snags put right" minHeight={56} onPress={() => router.push(`/sites/${siteId}/snags/sign`)} />
      ) : null}
      {rows.length > 0 ? (
        <Button label="Share report" variant="secondary" minHeight={48} loading={busy} onPress={() => void onShare()} />
      ) : null}
      {list && list.rows.length === 0 ? null : (
        <Button
          label="Raise a snag"
          variant={list && list.fixed_count > 0 && signOffsWaiting === 0 ? 'secondary' : 'primary'}
          minHeight={56}
          onPress={() => router.push(`/sites/${siteId}/snags/new`)}
        />
      )}
    </Screen>
  );
}
