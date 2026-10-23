import { Button, Card, ChoiceChip, EmptyState, ErrorText, Muted, Screen, Title } from '@/components/ui';
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
import { flushSnagQueue, getSnagQueue, noticesForOwner, type QueuedSnag, type SnagNotice } from '@/lib/snagQueue';
import { SAVED_ON_PHONE, deviceIsOnline } from '@/lib/variationQueue';
import { sendQueuedSnag } from '@/lib/sendQueuedSnag';
import { saveSheet } from '@/lib/saveSheet';
import { theme } from '@/lib/theme';
import { File as PhoneFile, Paths } from 'expo-file-system';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Platform, Text, View } from 'react-native';

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
    const queue = getSnagQueue();
    let signInRequired = false;
    if (ownerId && (await deviceIsOnline())) {
      const flushed = await flushSnagQueue(queue, (item) => sendQueuedSnag(item, undefined, queue), ownerId);
      signInRequired = flushed.signInRequired;
    }
    const pending = (await queue.list()).filter((item) => item.siteId === siteId && item.ownerId === ownerId);
    setQueued(pending);
    setNotices(noticesForOwner(await queue.listNotices(), ownerId).filter((notice) => notice.siteId === siteId));
    try {
      setList(await repo.listSnags(siteId));
      if (!signInRequired) setError('');
    } catch (err) {
      if (!signInRequired) setError(snagError(err instanceof Error ? err.message : 'unknown'));
    }
    if (signInRequired) setError('Sign in again to send what is saved on this phone.');
  }, [ownerId, siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load snags.'));
    }, [load])
  );

  const rows = list ? filterSnags(list.rows, status, level) : [];
  const levels = list ? snagLevels(list.rows) : [];

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
      await flushSnagQueue(queue, (item) => sendQueuedSnag(item, undefined, queue), ownerId);
    }
    await load();
  }

  async function signAgain(notice: SnagNotice) {
    await getSnagQueue().removeNotice(notice.id);
    setNotices((current) => current.filter((row) => row.id !== notice.id));
    router.push(`/sites/${siteId}/snags/sign`);
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
      <Title>Snags</Title>
      {list ? (
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
          {list.open_count} open · {list.fixed_count} fixed · {list.signed_off_count} signed off
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {STATUSES.map((item) => (
          <ChoiceChip key={item} label={item} selected={status === item} onPress={() => setStatus(item)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <ChoiceChip label="All levels" selected={level === 'All'} onPress={() => setLevel('All')} />
        {levels.map((item) => (
          <ChoiceChip key={item} label={item} selected={level === item} onPress={() => setLevel(item)} />
        ))}
      </View>
      {notices.map((notice) => (
        <Card key={notice.id}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{notice.message}</Text>
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
          <Text style={{ color: theme.currentInk, backgroundColor: theme.current, fontWeight: '800', padding: 12, borderRadius: 12 }}>
            {SAVED_ON_PHONE}
          </Text>
          {queued.map((item) => (
            <Card key={item.localId}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
                {item.kind === 'create' ? item.note : item.kind === 'fix' ? 'After photo waiting to send' : 'Sign-off waiting to send'}
              </Text>
              <Muted>{item.kind === 'create' ? formatUkDateTime(item.raisedAt) : item.kind === 'fix' ? formatUkDateTime(item.fixedAt) : formatUkDateTime(item.signedAt)}</Muted>
            </Card>
          ))}
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {list && rows.length === 0 && queued.length === 0 ? <EmptyState title="No snags in this filter" /> : null}
      {rows.map((row) => (
        <Card key={row.snag_id} onPress={() => router.push(`/sites/${siteId}/snags/${row.snag_id}`)}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
            {snagNumber(row.snag_seq)} · {row.trade_label}
          </Text>
          <Muted>
            {row.status}
            {row.level_area ? ` · ${row.level_area}` : ''} · {row.note}
          </Muted>
        </Card>
      ))}
      {list && list.fixed_count > 0 ? (
        <Button label="Sign off snags put right" minHeight={56} onPress={() => router.push(`/sites/${siteId}/snags/sign`)} />
      ) : null}
      <Button label="Share report" minHeight={56} loading={busy} onPress={() => void onShare()} />
      <Button label="Raise a snag" minHeight={56} onPress={() => router.push(`/sites/${siteId}/snags/new`)} />
    </Screen>
  );
}
