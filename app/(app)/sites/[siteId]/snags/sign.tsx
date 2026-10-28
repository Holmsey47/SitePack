import { SignaturePad } from '@/components/SignaturePad';
import { Button, ErrorText, Field, Muted, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { newId } from '@/data/newId';
import { canSignOffSnag, snagError, snagRoleLabel, type SnagDetail, type SnagSignoff } from '@/data/snags';
import { formatUkDateTime } from '@/lib/format';
import { dataUrlBytes } from '@/lib/signaturePng';
import { buildSnagSignoffPdf, snagSignoffFilename, snagSignoffReportId, type SnagPdfSnag } from '@/lib/snagPdf';
import { deviceIsOnline, persistThenSendSnag, SAVED_ON_PHONE } from '@/lib/snagQueue';
import { saveSheet } from '@/lib/saveSheet';
import { sendQueuedSnag } from '@/lib/sendQueuedSnag';
import { contractorPadEnabled, outstandingHeading, outstandingLine, putRightLine, SIGNED_ON_PHONE, signoffFormOpen, snagConfirmation, snagDisplayText, takeSignAgain } from '@/lib/snagWording';
import { textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { File as PhoneFile, Paths } from 'expo-file-system';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

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

type LocalSign = {
  confirmation: string;
  name: string;
  role: string;
  company: string;
  signedAt: string;
  putRight: string;
};

function queryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function SnagSignScreen() {
  const params = useLocalSearchParams<{ siteId: string }>();
  const siteId = queryValue(params.siteId);
  const { person } = useAuth();
  const [rows, setRows] = useState<SnagDetail[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [internalCompany, setInternalCompany] = useState('');
  const [contractorCompany, setContractorCompany] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [padKey, setPadKey] = useState(0);
  const [record, setRecord] = useState<SnagSignoff | null>(null);
  const [localSign, setLocalSign] = useState<LocalSign | null>(null);
  const [savedOnPhone, setSavedOnPhone] = useState(false);

  function clearSignFields() {
    setInternalCompany('');
    setContractorCompany('');
    setSignerName('');
    setSignerRole('');
    setSignature(null);
    setPadKey((key) => key + 1);
  }

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

  useFocusEffect(
    useCallback(() => {
      const draft = takeSignAgain();
      if (!draft) return;
      if (draft.signMode === 'contractor') {
        setSignerName(draft.signerName);
        setSignerRole(draft.signerRole);
        setContractorCompany(draft.signerCompany);
        setSignature(null);
        setPadKey((key) => key + 1);
        return;
      }
      if (draft.signMode === 'internal') setInternalCompany(draft.signerCompany);
    }, [])
  );

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
    if (!signoffFormOpen({ savedOnPhone, signedOff: Boolean(record || localSign) })) return;
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
        setLocalSign({
          confirmation: snagConfirmation(internalCompany, 'internal', shownCovered.length),
          name: person.display_name?.trim() || 'Someone on site',
          role: snagRoleLabel(person.role),
          company: internalCompany.trim(),
          signedAt,
          putRight: putRightLine(fixed.map((row) => ({ snagSeq: row.snag_seq, note: row.note }))),
        });
        setSavedOnPhone(true);
        clearSignFields();
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
      clearSignFields();
      await pdfFor(signed);
      await load();
    } catch (err) {
      setError(snagError(err instanceof Error ? err.message : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  async function onContractor() {
    if (!signoffFormOpen({ savedOnPhone, signedOff: Boolean(record || localSign) })) return;
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
        setLocalSign({
          confirmation: snagConfirmation(contractorCompany, 'contractor', shownCovered.length),
          name: signerName.trim(),
          role: signerRole.trim(),
          company: contractorCompany.trim(),
          signedAt,
          putRight: putRightLine(fixed.map((row) => ({ snagSeq: row.snag_seq, note: row.note }))),
        });
        setSavedOnPhone(true);
        clearSignFields();
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
      clearSignFields();
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

  const shownSign = record
    ? {
        confirmation: record.confirmation_text,
        name: record.signer_name,
        role: record.signer_role,
        company: record.signer_company,
        signedAt: record.signed_at,
      }
    : localSign;
  const formOpen = signoffFormOpen({ savedOnPhone, signedOff: Boolean(shownSign) });
  const shownOutstanding = record
    ? record.outstanding.map((item) => outstandingLine(item.snag_seq, item.note, item.level_area))
    : open.map((row) => outstandingLine(row.snag_seq, row.note, row.level_area));
  const outstandingCount = record ? record.outstanding.length : open.length;
  const formPutRight = putRightLine(fixed.map((row) => ({ snagSeq: row.snag_seq, note: row.note })));
  const signedPutRight = record
    ? putRightLine(record.covered.map((item) => ({ snagSeq: item.snag_seq, note: item.note })))
    : localSign?.putRight ?? formPutRight;

  return (
    <Screen>
      {shownSign ? (
        <View nativeID="signer-block" style={{ gap: 8 }}>
          <Text nativeID="sign-off-state" style={{ ...textStyle.title }}>
            {savedOnPhone ? SIGNED_ON_PHONE : 'Signed off'}
          </Text>
          <Text nativeID="put-right-list" style={{ ...textStyle.bodyStrong }}>
            {signedPutRight}
          </Text>
          {savedOnPhone ? (
            <Text
              nativeID="saved-on-phone"
              style={{ ...textStyle.bodyStrong, backgroundColor: theme.surface, padding: 12, borderRadius: 12 }}
            >
              {SAVED_ON_PHONE}
            </Text>
          ) : null}
          <Muted>{snagDisplayText(shownSign.confirmation)}</Muted>
          <Text style={{ ...textStyle.bodyStrong }}>{snagDisplayText(shownSign.name)}</Text>
          <Muted>{snagDisplayText(shownSign.role)}</Muted>
          <Muted>{snagDisplayText(shownSign.company)}</Muted>
          <Muted>Signed {formatUkDateTime(shownSign.signedAt)}</Muted>
        </View>
      ) : null}
      {formOpen ? (
        <>
          <Text nativeID="put-right-list" style={{ ...textStyle.bodyStrong }}>
            {formPutRight}
          </Text>
          {internal ? (
            <View nativeID="internal-check" style={{ gap: 8 }}>
              <Text style={{ ...textStyle.title }}>Internal check</Text>
              <Muted>This is an internal check. It is not sign-off by the main contractor.</Muted>
              <Field label="Company" value={internalCompany} onChangeText={setInternalCompany} autoCapitalize="words" maxLength={120} />
              <Muted>{snagDisplayText(snagConfirmation(internalCompany, 'internal', fixed.length))}</Muted>
              <Button
                label="Sign internal check"
                minHeight={56}
                loading={busy}
                disabled={!internalReady || fixed.length < 1}
                onPress={() => void onInternal()}
              />
            </View>
          ) : null}
          <View nativeID="contractor-sign" style={{ gap: 8 }}>
            <Text style={{ ...textStyle.title }}>Main contractor</Text>
            <Field label="Name" value={signerName} onChangeText={setSignerName} autoCapitalize="words" maxLength={120} />
            <Field label="Role" value={signerRole} onChangeText={setSignerRole} autoCapitalize="words" maxLength={80} />
            <Field
              label="Main contractor company"
              value={contractorCompany}
              onChangeText={setContractorCompany}
              autoCapitalize="words"
              maxLength={120}
            />
            <Muted>{snagDisplayText(snagConfirmation(contractorCompany, 'contractor', fixed.length))}</Muted>
            <SignaturePad key={padKey} disabled={!contractorPadEnabled(contractorCompany)} onChange={setSignature} />
            <Button
              label="Sign off snags put right"
              minHeight={56}
              loading={busy}
              disabled={!contractorReady || !signerName.trim() || !signerRole.trim() || !signature || fixed.length < 1}
              onPress={() => void onContractor()}
            />
          </View>
        </>
      ) : null}
      <View nativeID="outstanding-snags" style={{ gap: 8 }}>
        <Text style={{ ...textStyle.bodyStrong }}>Not signed off</Text>
        <Muted>{outstandingHeading(outstandingCount)}</Muted>
        {shownOutstanding.map((line) => (
          <Muted key={line}>{line}</Muted>
        ))}
      </View>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
