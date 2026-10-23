import { DrawingFrame } from '@/components/drawing-frame';
import { TalkNoticeList } from '@/components/TalkRows';
import { Button, Card, Muted, Screen, SeenRejectNotice, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { signedCountLabel, talkError, type TalkDetail } from '@/data/talks';
import { formatDate, formatUkDateTime } from '@/lib/format';
import { buildTalkPdf, talkPdfFilename } from '@/lib/talkPdf';
import { SAVED_ON_PHONE, SESSION_ENDED, dismissTalkNotice, getTalkQueue, persistThenSendTalk, retryQueuedTalk, type TalkNotice } from '@/lib/talkQueue';
import { talkSessionId } from '@/lib/talkSession';
import { refreshTalks, talkSend } from '@/lib/talkSync';
import { isFixtureOffline } from '@/lib/fixtureOffline';
import { deviceIsOnline } from '@/lib/variationQueue';
import { theme } from '@/lib/theme';
import { talkMeaning } from '@/lib/talkMeaning';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { saveSheet } from '@/lib/saveSheet';

function registerLabel(row: { person_name: string; person_ref: string }) {
  return row.person_ref ? `${row.person_name} · ${row.person_ref}` : row.person_name;
}

export default function TalkDetailScreen() {
  const { siteId, talkId } = useLocalSearchParams<{ siteId: string; talkId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const manage = person ? canManageSite(person.role) : false;
  const [talk, setTalk] = useState<TalkDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [notices, setNotices] = useState<TalkNotice[]>([]);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    if (!talkId) return;
    try {
      const next = await repo.getTalk(talkId);
      setTalk(next);
      if (person?.auth_user_id) {
        const refreshed = await refreshTalks(person.auth_user_id);
        setNotices(refreshed.notices.filter((row) => row.talkId === talkId));
        const waiting = refreshed.queued.some((item) => item.talkId === talkId && (item.attempts ?? 0) === 0);
        setNotice(waiting ? SAVED_ON_PHONE : '');
      } else {
        const queued = await getTalkQueue().list();
        setNotice(queued.some((item) => item.talkId === talkId) ? SAVED_ON_PHONE : '');
      }
      setError('');
    } catch (err) {
      setError(talkError(err instanceof Error ? err.message : 'unknown'));
    }
  }, [person?.auth_user_id, talkId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load the talk.'));
    }, [load])
  );

  useEffect(() => {
    if (!talk) return;
    const title = talk.register ? "Who's signed" : talk.kind === 'induction' ? 'Induction' : 'Toolbox talk';
    navigation.setOptions({ title });
  }, [navigation, talk]);

  async function toggleNote(personId: string, explained: boolean, interpreter: boolean) {
    if (!talkId || !person?.auth_user_id || !talk) return;
    const online = !isFixtureOffline() && (await deviceIsOnline());
    const result = await persistThenSendTalk(
      {
        localId: `note-${personId}-${talk.version_id}`,
        userId: person.auth_user_id,
        siteId: siteId ?? talk.site_id,
        talkId,
        versionId: talk.version_id,
        signerPersonId: personId,
        action: 'note',
        signaturePng: null,
        question: null,
        explainedVerbally: explained,
        interpreterUsed: interpreter,
        deviceAt: new Date().toISOString(),
        sessionId: talkSessionId(),
      },
      online,
      talkSend
    );
    if (result === 'queued') setNotice(SAVED_ON_PHONE);
    if (result === 'refused') {
      const saved = await getTalkQueue().listNotices();
      setNotice(saved.find((row) => row.talkId === talkId)?.message ?? 'That note was not saved. Try again.');
    }
    if (result === 'rejected') setError(SESSION_ENDED);
    if (result === 'sent') await load();
  }

  async function share() {
    if (!talk?.register) return;
    setSharing(true);
    try {
      const companyName = await repo.companyName();
      const { bytes } = await buildTalkPdf({
        companyName,
        siteName: talk.site_name,
        title: talk.title,
        kind: talk.kind,
        delivery: talk.delivery,
        versionNo: talk.version_no,
        presenterName: talk.presenter_name,
        presenterRole: talk.presenter_role,
        presentedAt: talk.presented_at,
        notSigned: talk.register.not_signed.map((row) => ({
          name: row.person_name,
          personRef: row.person_ref,
          nameChanged: row.name_changed,
          hasQuestion: row.has_question,
          question: row.question,
          explained: row.explained_verbally,
          interpreter: row.interpreter_used,
        })),
        signed: talk.register.signed.map((row) => ({
          name: row.person_name,
          personRef: row.person_ref,
          nameChanged: row.name_changed,
          hasQuestion: row.has_question,
          question: row.question,
          explained: row.explained_verbally,
          interpreter: row.interpreter_used,
          receivedAt: row.received_at,
          meaning: row.meaning,
          signaturePng: row.signature_png,
          sharedDevice: row.shared_device,
        })),
        presenterSignature: talk.register.presenter_signature
          ? {
              name: talk.register.presenter_signature.person_name,
              personRef: talk.register.presenter_signature.person_ref,
              nameChanged: talk.register.presenter_signature.name_changed,
              receivedAt: talk.register.presenter_signature.received_at,
              meaning: talk.register.presenter_signature.meaning,
              signaturePng: talk.register.presenter_signature.signature_png,
            }
          : null,
      });
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      const blob = new Blob([copy], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      await saveSheet(url, talkPdfFilename(talk.site_name, talk.title));
    } catch {
      setError('Could not share the register.');
    } finally {
      setSharing(false);
    }
  }

  if (!talk) {
    return (
      <Screen>
        <Title>Talk</Title>
        {error ? <Text style={{ color: theme.danger }}>{error}</Text> : <Muted>Loading…</Muted>}
      </Screen>
    );
  }

  const register = talk.register;
  const canRun = manage || person?.id === talk.presenter_person_id;
  const namedPresenter = person?.id === talk.presenter_person_id;
  const presenterLine = talkMeaning({
    kind: talk.kind,
    delivery: talk.delivery,
    signatureRole: namedPresenter ? 'presenter' : 'on_behalf',
    siteName: talk.site_name,
    title: talk.title,
    presenterName: talk.presenter_name,
    presentedOn: formatDate(talk.presented_at),
    managerName: person?.display_name ?? undefined,
  });

  return (
    <Screen>
      <Title>{talk.title}</Title>
      <Muted>
        {talk.kind === 'induction' ? 'Induction' : 'Toolbox talk'} · version {talk.version_no}
      </Muted>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>
        {talk.presenter_name}, {talk.presenter_role}
      </Text>
      <Muted>{formatUkDateTime(talk.presented_at)}</Muted>
      <Muted>{talk.delivery === 'in_person' ? 'Given in person' : 'Read on the phone'}</Muted>
      <TalkNoticeList
        notices={notices}
        onDismiss={(item) => {
          void dismissTalkNotice(getTalkQueue(), item).then(() =>
            setNotices((current) => current.filter((row) => row.id !== item.id))
          );
        }}
        onRetry={(item) => {
          if (!item.retryLocalId || !person?.auth_user_id) return;
          const userId = person.auth_user_id;
          void retryQueuedTalk(getTalkQueue(), item.retryLocalId)
            .then(() => refreshTalks(userId))
            .then((next) => setNotices(next.notices.filter((row) => row.talkId === talkId)));
        }}
      />
      {notice ? <SeenRejectNotice message={notice} /> : null}
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
      {talk.body ? <Text style={{ color: theme.text, fontSize: 17, lineHeight: 24 }}>{talk.body}</Text> : null}
      {talk.pdf_url ? (
        <View style={{ height: 360 }}>
          <DrawingFrame uri={talk.pdf_url} />
        </View>
      ) : null}
      {!talk.mine_signed ? (
        <Button
          label="Read and sign"
          minHeight={56}
          onPress={() => router.push(`/sites/${siteId}/talks/${talk.talk_id}/sign`)}
        />
      ) : (
        <Muted>You have signed this version.</Muted>
      )}
      {register ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
            {signedCountLabel(register.signed_count, register.required_count)}
          </Text>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800', minHeight: 48 }}>
            Not signed yet ({register.not_signed.length})
          </Text>
          {register.not_signed.map((row) => (
            <Card key={row.person_id}>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>{registerLabel(row)}</Text>
              {row.has_question ? <Text style={{ color: theme.text, fontWeight: '800' }}>Has a question</Text> : null}
              {row.question ? <Muted>{row.question}</Muted> : null}
              {row.explained_verbally ? <Muted>Explained verbally</Muted> : null}
              {row.interpreter_used ? <Muted>Interpreter used</Muted> : null}
              {canRun ? (
                <View style={{ gap: 8 }}>
                  <Button
                    label="Sign for this person"
                    minHeight={56}
                    onPress={() => router.push(`/sites/${siteId}/talks/${talk.talk_id}/sign?personId=${row.person_id}`)}
                  />
                  <Button
                    label={row.explained_verbally ? 'Explained verbally · on' : 'Explained verbally'}
                    variant="secondary"
                    onPress={() => void toggleNote(row.person_id, !row.explained_verbally, row.interpreter_used)}
                  />
                  <Button
                    label={row.interpreter_used ? 'Interpreter used · on' : 'Interpreter used'}
                    variant="secondary"
                    onPress={() => void toggleNote(row.person_id, row.explained_verbally, !row.interpreter_used)}
                  />
                </View>
              ) : null}
            </Card>
          ))}
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800', minHeight: 48 }}>Signed</Text>
          {register.signed.map((row) => (
            <Card key={row.person_id}>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>{registerLabel(row)}</Text>
              {row.name_changed ? <Muted>name changed since signing</Muted> : null}
              <Muted>{formatUkDateTime(row.received_at)}</Muted>
              <Text style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>{row.meaning}</Text>
              {row.shared_device ? <Text style={{ color: theme.text, fontWeight: '800' }}>Signed on a shared device</Text> : null}
              {row.explained_verbally ? <Muted>Explained verbally</Muted> : null}
              {row.interpreter_used ? <Muted>Interpreter used</Muted> : null}
            </Card>
          ))}
          {register.questions.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>Questions</Text>
              {register.questions.map((row) => (
                <Card key={row.person_id}>
                  <Text style={{ color: theme.text, fontWeight: '800' }}>{row.person_name}</Text>
                  <Muted>{row.body || 'Has a question'}</Muted>
                </Card>
              ))}
            </View>
          ) : null}
          {talk.delivery === 'in_person' && !register.presenter_signature && (namedPresenter || manage) ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>{presenterLine}</Text>
              <Button
                label={namedPresenter ? 'Sign that I gave this talk' : 'Sign for the presenter'}
                minHeight={56}
                onPress={() => router.push(`/sites/${siteId}/talks/${talk.talk_id}/sign?presenter=1`)}
              />
            </View>
          ) : null}
          {register.presenter_signature ? (
            <Card>
              <Text style={{ color: theme.text, fontWeight: '800' }}>Presenter · {registerLabel(register.presenter_signature)}</Text>
              {register.presenter_signature.name_changed ? <Muted>name changed since signing</Muted> : null}
              <Muted>{formatUkDateTime(register.presenter_signature.received_at)}</Muted>
              <Text style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>{register.presenter_signature.meaning}</Text>
            </Card>
          ) : null}
          <Button label="Share register" minHeight={56} loading={sharing} onPress={() => void share()} />
        </View>
      ) : null}
      {manage ? (
        <Button
          label="New version"
          variant="secondary"
          onPress={() => router.push(`/sites/${siteId}/talks/${talk.talk_id}/revise`)}
        />
      ) : null}
    </Screen>
  );
}
