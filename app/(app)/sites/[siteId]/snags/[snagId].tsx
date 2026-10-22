import { Button, ErrorText, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { newId } from '@/data/newId';
import { snagError, snagNumber, type SnagDetail } from '@/data/snags';
import { formatUkDateTime } from '@/lib/format';
import { preparePhoto } from '@/lib/photoPrep';
import { sendQueuedSnag } from '@/lib/sendQueuedSnag';
import { deviceIsOnline, persistThenSendSnag, SAVED_ON_PHONE, type QueuedPhoto } from '@/lib/snagQueue';
import { theme } from '@/lib/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';

type LocalPhoto = QueuedPhoto & { preview: string };

function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
}

export default function SnagDetailScreen() {
  const { snagId, siteId } = useLocalSearchParams<{ snagId: string; siteId: string }>();
  const router = useRouter();
  const { person } = useAuth();
  const fileRef = useRef<{ click: () => void } | null>(null);
  const [detail, setDetail] = useState<SnagDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [afterPhotos, setAfterPhotos] = useState<LocalPhoto[]>([]);

  const load = useCallback(async () => {
    if (!snagId) return;
    const next = await repo.getSnag(snagId);
    setDetail(next);
  }, [snagId]);

  useEffect(() => {
    load()
      .catch(() => setError('Could not load the snag.'))
      .finally(() => setLoaded(true));
  }, [load]);

  async function addBlob(blob: Blob) {
    const prepared = await preparePhoto({ blob });
    const preview = URL.createObjectURL(bytesToBlob(prepared.bytes, 'image/jpeg'));
    setAfterPhotos((current) =>
      current.length >= 10 ? current : [...current, { id: newId(), bytes: prepared.bytes, contentType: prepared.contentType, preview }]
    );
  }

  async function addFromPicker() {
    if (afterPhotos.length >= 10) return;
    if (Platform.OS === 'web') {
      fileRef.current?.click();
      return;
    }
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const prepared = await preparePhoto({ uri: result.assets[0].uri });
    setAfterPhotos((current) =>
      current.length >= 10
        ? current
        : [...current, { id: newId(), bytes: prepared.bytes, contentType: prepared.contentType, preview: result.assets[0].uri }]
    );
  }

  async function onFix() {
    if (!detail || !person?.auth_user_id || !siteId) return;
    if (afterPhotos.length < 1) {
      setError('Add an after photo.');
      return;
    }
    setBusy(true);
    setError('');
    const fixedAt = new Date().toISOString();
    const item = {
      kind: 'fix' as const,
      localId: newId(),
      ownerId: person.auth_user_id,
      siteId,
      companyId: person.company_id,
      snagId: detail.snag_id,
      photos: afterPhotos.map(({ id, bytes, contentType }) => ({ id, bytes, contentType })),
      fixedAt,
    };
    try {
      const result = await persistThenSendSnag(item, await deviceIsOnline(), sendQueuedSnag);
      if (result === 'queued') {
        setNotice(SAVED_ON_PHONE);
        return;
      }
      setAfterPhotos([]);
      setNotice('');
      await load();
    } catch (err) {
      setNotice(SAVED_ON_PHONE);
      setError(snagError(err instanceof Error ? err.message : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <Screen>
        <Muted>Loading snag…</Muted>
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen>
        <Title>Snag</Title>
        <ErrorText>{error || 'This snag is not on your sites.'}</ErrorText>
      </Screen>
    );
  }

  const before = detail.photos.filter((photo) => photo.kind === 'before');
  const after = detail.photos.filter((photo) => photo.kind === 'after');

  return (
    <Screen>
      <Title>
        {snagNumber(detail.snag_seq)} · {detail.trade_label}
      </Title>
      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{detail.status}</Text>
      <Muted>{detail.note}</Muted>
      {detail.level_area ? <Muted>Level or area · {detail.level_area}</Muted> : null}
      <Muted>
        Raised by {detail.raised_by_name} · {formatUkDateTime(detail.raised_at)}
      </Muted>
      {detail.fixed_at ? (
        <Muted>
          Fixed{detail.fixed_by_name ? ` by ${detail.fixed_by_name}` : ''} · {formatUkDateTime(detail.fixed_at)}
        </Muted>
      ) : null}
      {notice ? (
        <Text style={{ color: theme.currentInk, backgroundColor: theme.current, fontWeight: '800', padding: 12, borderRadius: 12 }}>{notice}</Text>
      ) : null}
      <Text style={{ color: theme.text, fontWeight: '800' }}>Before</Text>
      <View style={{ gap: 8 }}>
        {before.map((photo) =>
          photo.signed_url ? (
            <Image key={photo.id} source={{ uri: photo.signed_url }} style={{ width: '100%', height: 180, borderRadius: 8 }} accessibilityLabel="Before photo" />
          ) : null
        )}
      </View>
      {after.length > 0 ? <Text style={{ color: theme.text, fontWeight: '800' }}>After</Text> : null}
      <View style={{ gap: 8 }}>
        {after.map((photo) =>
          photo.signed_url ? (
            <Image key={photo.id} source={{ uri: photo.signed_url }} style={{ width: '100%', height: 180, borderRadius: 8 }} accessibilityLabel="After photo" />
          ) : null
        )}
      </View>
      {detail.signature ? (
        <View style={{ gap: 8 }}>
          <Muted>{detail.signature.confirmation_text}</Muted>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{detail.signature.signer_name}</Text>
          <Muted>{detail.signature.signer_role}</Muted>
          <Muted>{detail.signature.signer_company}</Muted>
          <Muted>Signed {formatUkDateTime(detail.signature.signed_at)}</Muted>
          {detail.signature.signature_png ? (
            <Image
              source={{ uri: detail.signature.signature_png }}
              style={{ width: '100%', height: 120, backgroundColor: '#F4F1EA', borderRadius: 12 }}
              accessibilityLabel="Signature"
            />
          ) : null}
        </View>
      ) : null}
      {detail.status === 'Open' ? (
        <View style={{ gap: 8 }}>
          {afterPhotos.map((photo) => (
            <Image key={photo.id} source={{ uri: photo.preview }} style={{ width: '100%', height: 180, borderRadius: 8 }} accessibilityLabel="After photo" />
          ))}
          <Button label="Add after photo" variant="secondary" minHeight={48} onPress={() => void addFromPicker().catch(() => setError('Could not read that photo.'))} />
          <Button label="Mark fixed" minHeight={56} loading={busy} disabled={afterPhotos.length < 1} onPress={() => void onFix()} />
        </View>
      ) : null}
      {detail.status === 'Fixed' ? (
        <Button label="Sign off snags put right" minHeight={56} onPress={() => router.push(`/sites/${siteId}/snags/sign`)} />
      ) : null}
      {Platform.OS === 'web'
        ? createElement('input', {
            ref: fileRef,
            type: 'file',
            accept: 'image/*',
            style: { display: 'none' },
            onChange: (event: { target: { files: FileList | null; value: string } }) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void addBlob(file)
                .catch(() => setError('Could not read that photo.'))
                .finally(() => {
                  event.target.value = '';
                });
            },
          })
        : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
