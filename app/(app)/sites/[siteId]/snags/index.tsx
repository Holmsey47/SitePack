import { Button, Card, ChoiceChip, EmptyState, ErrorText, Muted, Screen, Title } from '@/components/ui';
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
import { getSnagQueue, type QueuedSnag } from '@/lib/snagQueue';
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
  return new Uint8Array(await response.arrayBuffer());
}

export default function SnagsScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const router = useRouter();
  const [list, setList] = useState<SnagList | null>(null);
  const [queued, setQueued] = useState<QueuedSnag[]>([]);
  const [status, setStatus] = useState<SnagStatusFilter>('All');
  const [level, setLevel] = useState<SnagLevelFilter>('All');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    const pending = (await getSnagQueue().list()).filter((item) => item.siteId === siteId);
    setQueued(pending);
    if (pending.length > 0 && (await deviceIsOnline())) {
      for (const item of pending) {
        try {
          await sendQueuedSnag(item);
          await getSnagQueue().remove(item.localId);
        } catch {
          break;
        }
      }
      setQueued((await getSnagQueue().list()).filter((item) => item.siteId === siteId));
    }
    try {
      setList(await repo.listSnags(siteId));
      setError('');
    } catch (err) {
      setError(snagError(err instanceof Error ? err.message : 'unknown'));
    }
  }, [siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load snags.'));
    }, [load])
  );

  const rows = list ? filterSnags(list.rows, status, level) : [];
  const levels = list ? snagLevels(list.rows) : [];

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
        let before = 0;
        let after = 0;
        for (const photo of row.photos) {
          const bytes = await photoBytes(photo.signed_url);
          if (!bytes) continue;
          const caption = photo.kind === 'before' ? (before++ === 0 ? 'Before' : `Before ${before}`) : after++ === 0 ? 'After' : `After ${after}`;
          photos.push({ bytes, contentType: photo.content_type, caption });
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
      <Button label="Share report" minHeight={56} loading={busy} onPress={() => void onShare()} />
      <Button label="Raise a snag" minHeight={56} onPress={() => router.push(`/sites/${siteId}/snags/new`)} />
    </Screen>
  );
}
