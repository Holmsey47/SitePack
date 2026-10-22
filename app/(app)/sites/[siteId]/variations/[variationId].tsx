import { SignaturePad } from '@/components/SignaturePad';
import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import {
  canSeeVariationValue,
  canSetVariationValue,
  formatPounds,
  isVariationLocked,
  parsePounds,
  variationAmountEditorOpen,
  variationError,
  variationNumber,
  variationPdfFilename,
  type VariationDetail,
  type VariationPhoto,
} from '@/data/variations';
import { formatUkDateTime } from '@/lib/format';
import { buildVariationPdf } from '@/lib/variationPdf';
import { variationConfirmation, variationHandoverSummary } from '@/lib/variationWording';
import { dataUrlBytes } from '@/lib/signaturePng';
import { saveSheet } from '@/lib/saveSheet';
import { theme } from '@/lib/theme';
import { File as PhoneFile, Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { createElement, useCallback, useEffect, useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';

function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
}

async function bytesFor(photo: VariationPhoto): Promise<Uint8Array | null> {
  if (!photo.signed_url) return null;
  if (photo.signed_url.startsWith('data:')) return dataUrlBytes(photo.signed_url);
  const response = await fetch(photo.signed_url);
  return new Uint8Array(await response.arrayBuffer());
}

export default function VariationDetailScreen() {
  const { variationId } = useLocalSearchParams<{ variationId: string; siteId: string }>();
  const { person } = useAuth();
  const [detail, setDetail] = useState<VariationDetail | null>(null);
  const [company, setCompany] = useState('');
  const [siteName, setSiteName] = useState('');
  const [error, setError] = useState('');
  const [signing, setSigning] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('');
  const [signerCompany, setSignerCompany] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(async () => {
    if (!variationId) return;
    const next = await repo.getVariation(variationId);
    setDetail(next);
    if (!next) return;
    const [name, site] = await Promise.all([repo.companyName(), repo.getSite(next.site_id)]);
    setCompany(name);
    setSiteName(site?.name ?? 'Site');
    if (next.current.value_pence != null) setAmount((next.current.value_pence / 100).toFixed(2));
    setLoaded(true);
  }, [variationId]);

  useEffect(() => {
    load()
      .catch(() => setError('Could not load the variation.'))
      .finally(() => setLoaded(true));
  }, [load]);

  const manager = person ? canSetVariationValue(person.role) : false;
  const seeValue = person ? canSeeVariationValue(person.role) : false;
  const current = detail?.current;

  async function onSign() {
    if (!current || !signature) return;
    setBusy(true);
    setError('');
    try {
      await repo.signVariation(current.version_id, {
        signerName,
        role: signerRole,
        company: signerCompany,
        expectedPence: seeValue ? current.value_pence : null,
        signaturePng: signature,
      });
      setSigning(false);
      await load();
    } catch (err) {
      setError(variationError(err instanceof Error ? err.message : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  async function onValue() {
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      await repo.setVariationValue(current.version_id, parsePounds(amount));
      await load();
    } catch (err) {
      setError(variationError(err instanceof Error ? err.message : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  async function makePdf() {
    if (!detail || !current) throw new Error('not_found');
    const photos = [];
    for (const photo of current.photos) {
      const bytes = await bytesFor(photo);
      if (bytes) photos.push({ bytes, contentType: photo.content_type });
    }
    const signaturePng = current.signature ? dataUrlBytes(current.signature.signature_png) : null;
    return buildVariationPdf({
      voSeq: detail.vo_seq,
      versionNo: current.version_no,
      companyName: company,
      siteName,
      title: current.title,
      description: current.description,
      levelArea: current.level_area,
      quantityText: current.quantity_text,
      valuePence: seeValue ? current.signature?.shown_value_pence ?? null : null,
      whenIso: current.signature?.signed_at ?? current.locked_at ?? current.created_at,
      signerName: current.signature?.signer_name ?? null,
      signerRole: current.signature?.signer_role ?? null,
      signerCompany: current.signature?.signer_company ?? null,
      confirmationText: current.signature?.confirmation_text || variationConfirmation(signerCompany, false),
      photos,
      signaturePng,
    });
  }

  async function onPreview() {
    setBusy(true);
    setError('');
    try {
      const bytes = await makePdf();
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(bytesToBlob(bytes, 'application/pdf'));
        setPreviewUrl(url);
      }
      setShowPreview(true);
    } catch {
      setError('Could not build the PDF.');
    } finally {
      setBusy(false);
    }
  }

  async function onShare() {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      const bytes = await makePdf();
      const name = variationPdfFilename(detail.vo_seq);
      if (Platform.OS === 'web') {
        const blob = bytesToBlob(bytes, 'application/pdf');
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setShowPreview(true);
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
      setError('Could not share the PDF.');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <Screen>
        <Muted>Loading variation…</Muted>
      </Screen>
    );
  }

  if (!detail || !current) {
    return (
      <Screen>
        <Title>Variation</Title>
        <ErrorText>{error || 'This variation is not on your sites.'}</ErrorText>
      </Screen>
    );
  }

  const locked = isVariationLocked(current.status);

  return (
    <Screen>
      <Title>
        {variationNumber(detail.vo_seq)} · {current.title}
      </Title>
      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{current.status}</Text>
      {locked ? (
        <Text style={{ color: theme.currentInk, backgroundColor: theme.current, fontWeight: '800', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}>
          Locked
        </Text>
      ) : null}
      {current.description ? <Muted>{current.description}</Muted> : null}
      {current.level_area ? <Muted>Level or area · {current.level_area}</Muted> : null}
      {current.quantity_text ? <Muted>Quantity or hours · {current.quantity_text}</Muted> : null}
      {seeValue && current.value_pence != null ? <Muted>Amount · {formatPounds(current.value_pence)}</Muted> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {current.photos.map((photo) =>
          photo.signed_url ? (
            <Image
              key={photo.id}
              source={{ uri: photo.signed_url }}
              style={{ width: 96, height: 96, borderRadius: 8 }}
              accessibilityLabel="Variation photo"
            />
          ) : null
        )}
      </View>
      {current.signature ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>{current.signature.confirmation_text}</Text>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{current.signature.signer_name}</Text>
          <Muted>{current.signature.signer_role}</Muted>
          <Muted>{current.signature.signer_company}</Muted>
          <Muted>{formatUkDateTime(current.signature.signed_at)}</Muted>
          <Image
            source={{ uri: current.signature.signature_png }}
            style={{ width: '100%', height: 120, backgroundColor: '#F4F1EA', borderRadius: 12 }}
            accessibilityLabel="Signature"
          />
        </View>
      ) : null}
      {detail.history.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.text, fontWeight: '800' }}>Earlier versions kept</Text>
          {detail.history.map((version) => (
            <Muted key={version.version_id}>
              Version {version.version_no} · {version.status} · {version.title}
            </Muted>
          ))}
        </View>
      ) : null}
      {variationAmountEditorOpen(locked, manager, signing) ? (
        <View style={{ gap: 8 }}>
          <Field label="£ ex VAT" value={amount} onChangeText={setAmount} placeholder="0.00" />
          <Button label="Save amount" variant="secondary" minHeight={48} loading={busy} onPress={() => void onValue()} />
        </View>
      ) : null}
      {!locked && !signing ? (
        <Button label="Hand the phone over" minHeight={56} onPress={() => setSigning(true)} />
      ) : null}
      {signing && !locked ? (
        <View style={{ gap: 8 }}>
          <Title>Hand the phone over</Title>
          <Muted>The site manager types their name and signs.</Muted>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>
            {variationHandoverSummary(detail.vo_seq, current.title, seeValue ? current.value_pence : null, current.photos.length)}
          </Text>
          <Field label="Name" value={signerName} onChangeText={setSignerName} autoCapitalize="words" maxLength={120} />
          <Field label="Role" value={signerRole} onChangeText={setSignerRole} autoCapitalize="words" maxLength={120} />
          <Field label="Company" value={signerCompany} onChangeText={setSignerCompany} autoCapitalize="words" maxLength={160} />
          <Text style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>
            {variationConfirmation(signerCompany, seeValue && current.value_pence != null)}
          </Text>
          <SignaturePad disabled={!signerCompany.trim()} onChange={setSignature} />
          <Button
            label="Sign and lock"
            minHeight={56}
            loading={busy}
            disabled={!signerName.trim() || !signerRole.trim() || !signerCompany.trim() || !signature}
            onPress={() => void onSign()}
          />
        </View>
      ) : null}
      {locked ? (
        <View style={{ gap: 8 }}>
          <Button label="Share PDF" minHeight={56} loading={busy} onPress={() => void onShare()} />
          <Button label="Preview PDF" variant="secondary" minHeight={48} onPress={() => void onPreview()} />
          {manager && current.status === 'Signed' ? (
            <Button
              label="Mark as sent"
              variant="secondary"
              minHeight={48}
              onPress={() => {
                setBusy(true);
                void repo
                  .sendVariation(current.version_id)
                  .then(() => load())
                  .catch((err: unknown) => setError(variationError(err instanceof Error ? err.message : 'unknown')))
                  .finally(() => setBusy(false));
              }}
            />
          ) : null}
          {manager ? (
          <Button
            label="Edit as new version"
            variant="secondary"
            minHeight={48}
            onPress={() => {
              setBusy(true);
              void repo
                .reviseVariation(current.version_id)
                .then(() => load())
                .catch((err: unknown) => setError(variationError(err instanceof Error ? err.message : 'unknown')))
                .finally(() => setBusy(false));
            }}
          />
          ) : null}
        </View>
      ) : null}
      {showPreview ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>{variationPdfFilename(detail.vo_seq).replace(/\.pdf$/, '')}</Text>
          <Muted>{company}</Muted>
          <Muted>{siteName}</Muted>
          <Muted>{formatUkDateTime(current.signature?.signed_at ?? current.created_at)}</Muted>
          {current.photos.map((photo) =>
            photo.signed_url ? (
              <Image key={`pdf-${photo.id}`} source={{ uri: photo.signed_url }} style={{ width: '100%', height: 160, borderRadius: 8 }} />
            ) : null
          )}
          {current.signature ? (
            <Image source={{ uri: current.signature.signature_png }} style={{ width: '100%', height: 100, backgroundColor: '#F4F1EA' }} />
          ) : null}
          {previewUrl && Platform.OS === 'web'
            ? createElement('iframe', {
                title: variationPdfFilename(detail.vo_seq),
                src: previewUrl,
                style: { width: '100%', height: 420, border: 0, background: '#fff' },
              })
            : null}
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
