import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { talkError } from '@/data/talks';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

export default function ReviseTalkScreen() {
  const { siteId, talkId } = useLocalSearchParams<{ siteId: string; talkId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!talkId) return;
    repo
      .getTalk(talkId)
      .then((talk) => {
        if (!talk) return;
        setTitle(talk.title);
        setBody(talk.body);
      })
      .catch(() => setError('Could not load the talk.'));
  }, [talkId]);

  if (person && !canManageSite(person.role)) return <Redirect href={`/sites/${siteId}/talks`} />;

  async function onSave() {
    if (!talkId) return;
    setSaving(true);
    setError('');
    try {
      await repo.reviseTalk(talkId, { title, body, pdfPath: null });
      router.back();
    } catch (err) {
      setError(talkError(err instanceof Error ? err.message : 'unknown'));
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Title>New version</Title>
      <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="sentences" />
      <Field label="What it says" value={body} onChangeText={setBody} multiline autoCapitalize="sentences" />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label="Save new version" minHeight={56} loading={saving} onPress={() => void onSave()} />
    </Screen>
  );
}
