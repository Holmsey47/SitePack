import { DrawingFrame } from '@/components/drawing-frame';
import { SignaturePad } from '@/components/SignaturePad';
import { Button, ErrorText, Field, Muted, Screen, SeenRejectNotice, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { talkError, type TalkDetail } from '@/data/talks';
import { formatDate, formatUkDateTime } from '@/lib/format';
import { isFixtureOffline } from '@/lib/fixtureOffline';
import { SAVED_ON_PHONE, persistThenSendTalk } from '@/lib/talkQueue';
import { talkMeaning } from '@/lib/talkMeaning';
import { talkSessionId } from '@/lib/talkSession';
import { talkSend } from '@/lib/talkSync';
import { theme } from '@/lib/theme';
import { deviceIsOnline } from '@/lib/variationQueue';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function SignTalkScreen() {
  const params = useLocalSearchParams<{ siteId: string; talkId: string; personId?: string; presenter?: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [talk, setTalk] = useState<TalkDetail | null>(null);
  const [meaning, setMeaning] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const presenter = params.presenter === '1';
  const signerId = presenter ? person?.id ?? '' : params.personId || person?.id || '';

  useEffect(() => {
    if (!params.talkId) return;
    let active = true;
    repo
      .getTalk(params.talkId)
      .then((next) => {
        if (!active || !next) return;
        setTalk(next);
        const local = talkMeaning({
          kind: next.kind,
          delivery: next.delivery,
          signatureRole: presenter ? 'presenter' : 'attendee',
          siteName: next.site_name,
          title: next.title,
          presenterName: next.presenter_name,
          presentedOn: formatDate(next.presented_at),
        });
        setMeaning(presenter ? local : next.attendee_meaning || local);
        if (!presenter && signerId && signerId !== person?.id) {
          repo
            .talkMeaningLine(next.talk_id, signerId)
            .then((line) => {
              if (active && line) setMeaning(line);
            })
            .catch(() => setMeaning(local));
        }
      })
      .catch((err: unknown) => setError(talkError(err instanceof Error ? err.message : 'unknown')));
    return () => {
      active = false;
    };
  }, [params.talkId, person?.id, presenter, signerId]);

  const signerName =
    talk?.register?.not_signed.find((row) => row.person_id === signerId)?.person_name ||
    talk?.register?.signed.find((row) => row.person_id === signerId)?.person_name ||
    (signerId === person?.id ? person?.display_name : null) ||
    'This person';

  async function submit(action: 'sign' | 'question' | 'presenter') {
    if (!talk || !person?.auth_user_id || !signerId) return;
    if (action !== 'question' && (!understood || !signature)) {
      setError('Tick that you have read it, then sign.');
      return;
    }
    setSaving(true);
    setError('');
    const item = {
      localId: `${action}-${signerId}-${talk.version_id}`,
      userId: person.auth_user_id,
      siteId: talk.site_id,
      talkId: talk.talk_id,
      versionId: talk.version_id,
      signerPersonId: signerId,
      action,
      signaturePng: signature,
      question,
      explainedVerbally: false,
      interpreterUsed: false,
      deviceAt: new Date().toISOString(),
      sessionId: talkSessionId(),
    };
    try {
      const online = !isFixtureOffline() && (await deviceIsOnline());
      const result = await persistThenSendTalk(item, online, talkSend);
      if (result === 'queued') {
        setNotice(SAVED_ON_PHONE);
        setSaving(false);
        return;
      }
      if (result === 'refused') {
        setNotice(action === 'question' ? 'That question was not saved.' : 'That signature was not saved.');
        setSaving(false);
        return;
      }
      router.back();
    } catch (err) {
      setError(talkError(err instanceof Error ? err.message : 'unknown'));
      setSaving(false);
    }
  }

  if (!talk) {
    return (
      <Screen>
        <Muted>Loading…</Muted>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{presenter ? 'Presenter sign-off' : signerName}</Title>
      <Muted>
        {talk.title} · version {talk.version_no}
      </Muted>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>
        {talk.presenter_name}, {talk.presenter_role}
      </Text>
      <Muted>{formatUkDateTime(talk.presented_at)}</Muted>
      {talk.body ? <Text style={{ color: theme.text, fontSize: 17, lineHeight: 24 }}>{talk.body}</Text> : null}
      {talk.pdf_url ? (
        <View style={{ height: 280 }}>
          <DrawingFrame uri={talk.pdf_url} />
        </View>
      ) : null}
      <Text accessibilityRole="text" style={{ color: theme.text, fontSize: 17, lineHeight: 24, fontWeight: '700' }}>
        {meaning}
      </Text>
      {notice ? <SeenRejectNotice message={notice} /> : null}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: understood }}
        onPress={() => setUnderstood((value) => !value)}
        style={{ minHeight: 48, justifyContent: 'center' }}>
        <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>
          {understood ? 'Ticked · I\'ve read and understood' : 'I\'ve read and understood'}
        </Text>
      </Pressable>
      <View style={{ gap: 8 }}>
        <SignaturePad onChange={setSignature} />
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button
        label={presenter ? 'Sign that I gave this talk' : 'Sign'}
        minHeight={56}
        loading={saving}
        disabled={!understood || !signature}
        onPress={() => void submit(presenter ? 'presenter' : 'sign')}
      />
      {!presenter ? (
        <View style={{ gap: 8 }}>
          <Button label="I have a question" variant="secondary" minHeight={56} onPress={() => setAsking((value) => !value)} />
          {asking ? (
            <Field label="Question" value={question} onChangeText={setQuestion} multiline autoCapitalize="sentences" />
          ) : null}
          {asking ? (
            <Button label="Send question" minHeight={56} loading={saving} onPress={() => void submit('question')} />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
