import { PhotoPicker, type PickedPhoto } from '@/components/PhotoPicker';
import { Button, ErrorText, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { newId } from '@/data/newId';
import { markFixedDisabledReason, snagError, snagNumber, type SnagDetail } from '@/data/snags';
import { formatUkDateTime } from '@/lib/format';
import { sendQueuedSnag } from '@/lib/sendQueuedSnag';
import { deviceIsOnline, getSnagQueue, persistThenSendSnag, SAVED_ON_PHONE, signOffQueuedForSnag } from '@/lib/snagQueue';
import { showSignOffOnSnag, SIGN_OFF_QUEUED, snagDisplayText } from '@/lib/snagWording';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';

export default function SnagDetailScreen() {
  const { snagId, siteId } = useLocalSearchParams<{ snagId: string; siteId: string }>();
  const router = useRouter();
  const { person } = useAuth();
  const [detail, setDetail] = useState<SnagDetail | null>(null);
  const [error, setError] = useState('');
  const [fixError, setFixError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [afterPhotos, setAfterPhotos] = useState<PickedPhoto[]>([]);
  const [signQueued, setSignQueued] = useState(false);

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

  useFocusEffect(
    useCallback(() => {
      if (!snagId || !siteId) return;
      getSnagQueue()
        .list()
        .then((items) => setSignQueued(signOffQueuedForSnag(items, person?.auth_user_id, siteId, snagId)))
        .catch(() => setSignQueued(false));
    }, [person?.auth_user_id, siteId, snagId])
  );

  function addAfterPhotos(picked: PickedPhoto[]) {
    setAfterPhotos((current) => {
      const room = 10 - current.length;
      if (room <= 0) return current;
      return [...current, ...picked.slice(0, room)];
    });
  }

  async function onFix() {
    if (!detail || !siteId) return;
    const blocked = markFixedDisabledReason({
      signedIn: Boolean(person?.auth_user_id),
      role: person?.role ?? null,
      assigned: true,
      status: detail.status,
      afterPhotoCount: afterPhotos.length,
      saving: busy,
      signOffPending: signQueued,
    });
    if (blocked) return;
    if (!person?.auth_user_id) return;
    setBusy(true);
    setError('');
    setFixError('');
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
      setFixError(snagError(err instanceof Error ? err.message : 'unknown'));
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
  const markFixedReason =
    detail.status === 'Open'
      ? markFixedDisabledReason({
          signedIn: Boolean(person?.auth_user_id),
          role: person?.role ?? null,
          assigned: true,
          status: detail.status,
          afterPhotoCount: afterPhotos.length,
          saving: busy,
          signOffPending: signQueued,
        })
      : null;

  return (
    <Screen>
      <Title>
        {snagNumber(detail.snag_seq)} · {detail.trade_label}
      </Title>
      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{detail.status}</Text>
      <Muted>{snagDisplayText(detail.note)}</Muted>
      {detail.level_area ? <Muted>Level or area · {snagDisplayText(detail.level_area)}</Muted> : null}
      <Muted>
        Raised by {snagDisplayText(detail.raised_by_name)} · {formatUkDateTime(detail.raised_at)}
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
          <PhotoPicker count={afterPhotos.length} title="Add after photo" onAdd={addAfterPhotos} onError={setError} />
          {markFixedReason ? (
            <Text nativeID="mark-fixed-reason" style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>
              {markFixedReason}
            </Text>
          ) : null}
          {fixError ? (
            <Text nativeID="mark-fixed-error" style={{ color: theme.danger, fontSize: 16, fontWeight: '800' }}>
              {fixError}
            </Text>
          ) : null}
          <Button
            label="Mark fixed"
            minHeight={56}
            loading={busy}
            disabled={markFixedReason !== null}
            onPress={() => void onFix()}
          />
        </View>
      ) : null}
      {signQueued ? (
        <Text nativeID="signoff-waiting" style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
          {SIGN_OFF_QUEUED}
        </Text>
      ) : showSignOffOnSnag(detail.status) ? (
        <Button label="Sign off snags put right" minHeight={56} onPress={() => router.push(`/sites/${siteId}/snags/sign`)} />
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
