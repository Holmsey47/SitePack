import { SignaturePad } from '@/components/SignaturePad';
import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { newId } from '@/data/newId';
import { canSignOffSnag, snagError, snagNumber, type SnagDetail, type SnagSignoff } from '@/data/snags';
import { formatUkDateTime } from '@/lib/format';
import { dataUrlBytes } from '@/lib/signaturePng';
import { buildSnagSignoffPdf, snagSignoffFilename, snagSignoffReportId, type SnagPdfSnag } from '@/lib/snagPdf';
import { deviceIsOnline, persistThenSendSnag, SAVED_ON_PHONE } from '@/lib/snagQueue';
import { saveSheet } from '@/lib/saveSheet';
import { sendQueuedSnag } from '@/lib/sendQueuedSnag';
import { contractorPadEnabled, outstandingHeading, outstandingLine, snagConfirmation } from '@/lib/snagWording';
import { theme } from '@/lib/theme';
import { File as PhoneFile, Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';

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

async function sharePdf(bytes: Uint8Array, name: string) {
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
}

export default function SnagSignScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const [rows, setRows] = useState<SnagDetail[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [internalCompany, setInternalCompany] = useState('');
  const [contractorCompany, setContractorCompany] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [record, setRecord] = useState<SnagSignoff | null>(null);

  const load = useCallback(async () => {
    if (!siteId) return;
    const report = await repo.snagReport(siteId);
    setRows(report.rows);
  }, [siteId]);

  useEffect(() => {
    load()
      .catch(() => setError('Could not load snags.'))
      .finally(() => setLoaded(true));
  }, [load]);

  const fixed = rows.filter((row) => row.status === 'Fixed');
  const open = rows.filter((row) => row.status === 'Open');
  const coveredIds = fixed.map((row) => row.snag_id);
  const outstandingIds = open.map((row) => row.snag_id);
  const internal = person ? canSignOffSnag(person.role) : false;
  const internalReady = internalCompany.trim().length > 0;
  const contractorReady = contractorPadEnabled(contractorCompany);

  async function pdfFor(signed: SnagSignoff) {
    if (!siteId) return;
    const [companyName, site] = await Promise.all([repo.companyName(), repo.getSite(siteId)]);
    const byId = new Map(rows.map((row) => [row.snag_id, row]));
    const covered: SnagPdfSnag[] = [];
    for (const item of signed.covered) {
      const row = byId.get(item.snag_id);
      const photos = [];
      const source = row?.photos ?? [];
      if (source.length === 0) {
        for (const path of item.photo_paths ?? []) {
          photos.push({ bytes: null, contentType: 'image/jpeg', kind: 'before' as const });
          void path;
        }
      } else {
        for (const photo of source) {
          photos.push({ bytes: await photoBytes(photo.signed_url), contentType: photo.content_type, kind: photo.kind });
        }
      }
      covered.push({
        snagSeq: item.snag_seq,
        note: item.note,
        levelArea: item.level_area,
        tradeLabel: row?.trade_label ?? '',
        status: item.status ?? 'Fixed',
        raisedByName: row?.raised_by_name ?? '',
        raisedAt: row?.raised_at ?? signed.signed_at,
        fixedAt: row?.fixed_at ?? null,
        photos,
        signature: null,
      });
    }
    const generatedAt = signed.signed_at;
    const reportId = snagSignoffReportId(generatedAt);
    const { bytes } = await buildSnagSignoffPdf({
      reportId,
      kind: signed.kind,
      companyName,
      siteName: site?.name ?? 'Site',
      generatedAt,
      confirmationText: signed.confirmation_text,
      signerName: signed.signer_name,
      signerRole: signed.signer_role,
      signerCompany: signed.signer_company,
      signedAt: signed.signed_at,
      signaturePng: signed.signature_png ? dataUrlBytes(signed.signature_png) : null,
      covered,
      outstanding: signed.outstanding.map((item) => ({
        snagSeq: item.snag_seq,
        note: item.note,
        levelArea: item.level_area,
      })),
    });
    await sharePdf(bytes, snagSignoffFilename(reportId, signed.kind));
  }

  async function onInternal() {
    if (!siteId || !person?.auth_user_id || !internalReady) return;
    setBusy(true);
    setError('');
    const signedAt = new Date().toISOString();
    const signoffId = newId();
    const shownCovered = coveredIds;
    const shownOutstanding = outstandingIds;
    try {
      const online = await deviceIsOnline();
      if (!online) {
        await persistThenSendSnag(
          {
            kind: 'sign',
            localId: signoffId,
            ownerId: person.auth_user_id,
            siteId,
            signedAt,
            mode: 'internal',
            signerCompany: internalCompany.trim(),
            coveredIds: shownCovered,
            outstandingIds: shownOutstanding,
          },
          false,
          sendQueuedSnag
        );
        setNotice(SAVED_ON_PHONE);
        return;
      }
      const signed = await repo.signOffSnagsInternal({
        signoffId,
        siteId,
        signedAt,
        company: internalCompany.trim(),
        coveredIds: shownCovered,
        outstandingIds: shownOutstanding,
      });
      setRecord(signed);
      await pdfFor(signed);
      await load();
    } catch (err) {
      setError(snagError(err instanceof Error ? err.message : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  async function onContractor() {
    if (!siteId || !person?.auth_user_id || !contractorReady || !signature) return;
    setBusy(true);
    setError('');
    const signedAt = new Date().toISOString();
    const signoffId = newId();
    const shownCovered = coveredIds;
    const shownOutstanding = outstandingIds;
    const item = {
      kind: 'sign' as const,
      localId: signoffId,
      ownerId: person.auth_user_id,
      siteId,
      signedAt,
      mode: 'contractor' as const,
      signerName: signerName.trim(),
      signerRole: signerRole.trim(),
      signerCompany: contractorCompany.trim(),
      signaturePng: signature,
      coveredIds: shownCovered,
      outstandingIds: shownOutstanding,
    };
    try {
      const online = await deviceIsOnline();
      if (!online) {
        await persistThenSendSnag(item, false, sendQueuedSnag);
        setNotice(SAVED_ON_PHONE);
        return;
      }
      const signed = await repo.signOffSnagsContractor({
        signoffId,
        siteId,
        signedAt,
        company: item.signerCompany,
        signerName: item.signerName,
        signerRole: item.signerRole,
        signaturePng: signature,
        coveredIds: shownCovered,
        outstandingIds: shownOutstanding,
      });
      setRecord(signed);
      await pdfFor(signed);
      await load();
    } catch (err) {
      setError(snagError(err instanceof Error ? err.message : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <Screen>
        <Muted>Loading snags…</Muted>
      </Screen>
    );
  }

  const shownOutstanding = record
    ? record.outstanding.map((item) => outstandingLine(item.snag_seq, item.note, item.level_area))
    : open.map((row) => outstandingLine(row.snag_seq, row.note, row.level_area));
  const outstandingCount = record ? record.outstanding.length : open.length;

  return (
    <Screen>
      <Title>Sign off snags put right</Title>
      {internal ? (
        <View nativeID="internal-check" style={{ gap: 8 }}>
          <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>Internal check</Text>
          <Muted>This is an internal check. It is not sign-off by the main contractor.</Muted>
          <Field label="Company" value={internalCompany} onChangeText={setInternalCompany} autoCapitalize="words" maxLength={120} />
          <Muted>{snagConfirmation(internalCompany, 'internal')}</Muted>
          <Button
            label="Sign off snags put right"
            minHeight={56}
            loading={busy}
            disabled={!internalReady || fixed.length < 1}
            onPress={() => void onInternal()}
          />
        </View>
      ) : null}
      <View nativeID="contractor-sign" style={{ gap: 8 }}>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>Main contractor</Text>
        <Field label="Name" value={signerName} onChangeText={setSignerName} autoCapitalize="words" maxLength={120} />
        <Field label="Role" value={signerRole} onChangeText={setSignerRole} autoCapitalize="words" maxLength={80} />
        <Field
          label="Main contractor company"
          value={contractorCompany}
          onChangeText={setContractorCompany}
          autoCapitalize="words"
          maxLength={120}
        />
        <Muted>{snagConfirmation(contractorCompany, 'contractor')}</Muted>
        <SignaturePad disabled={!contractorPadEnabled(contractorCompany)} onChange={setSignature} />
        <Button
          label="Sign off snags put right"
          minHeight={56}
          loading={busy}
          disabled={!contractorReady || !signerName.trim() || !signerRole.trim() || !signature || fixed.length < 1}
          onPress={() => void onContractor()}
        />
      </View>
      {record ? (
        <View nativeID="signer-block" style={{ gap: 8 }}>
          <Muted>{record.confirmation_text}</Muted>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{record.signer_name}</Text>
          <Muted>{record.signer_role}</Muted>
          <Muted>{record.signer_company}</Muted>
          <Muted>Signed {formatUkDateTime(record.signed_at)}</Muted>
        </View>
      ) : null}
      <View nativeID="outstanding-snags" style={{ gap: 8 }}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{outstandingHeading(outstandingCount)}</Text>
        {shownOutstanding.map((line) => (
          <Muted key={line}>{line}</Muted>
        ))}
        {record ? null : (
          <Muted>
            {fixed.length < 1
              ? 'No snags are marked put right yet.'
              : `${fixed.length} put right: ${fixed.map((row) => snagNumber(row.snag_seq)).join(', ')}`}
          </Muted>
        )}
      </View>
      {notice ? (
        <Text style={{ color: theme.currentInk, backgroundColor: theme.current, fontWeight: '800', padding: 12, borderRadius: 12 }}>{notice}</Text>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
