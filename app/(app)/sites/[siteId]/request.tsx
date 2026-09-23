import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { repo } from '@/data/index';
import { requestSentLine } from '@/data/walk';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

export default function RequestDrawingScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentLine, setSentLine] = useState<string | null>(null);

  async function onSubmit() {
    if (!siteId || !body.trim()) return;
    setLoading(true);
    setError('');
    try {
      await repo.createRequest({ siteId, body: body.trim(), sheetHint: hint.trim() || null });
      const assignments = await repo.listAssignments(siteId).catch(() => []);
      const names = assignments
        .filter((row) => row.person?.role === 'cm')
        .map((row) => row.person?.display_name ?? '');
      setSentLine(requestSentLine(names));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send request');
    } finally {
      setLoading(false);
    }
  }

  if (sentLine) {
    return (
      <Screen>
        <Title>{sentLine}</Title>
        <Button label="Back to pack" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Request a drawing</Title>
      <Field
        label="What do you need?"
        value={body}
        onChangeText={setBody}
        placeholder="e.g. ceiling setting-out for kitchen"
        multiline
        autoCapitalize="sentences"
      />
      <Field
        label="Sheet / ref hint (optional)"
        value={hint}
        onChangeText={setHint}
        placeholder="A-101 soffit"
        autoCapitalize="none"
      />
      <ErrorText>{error}</ErrorText>
      <Button label="Send request" onPress={() => void onSubmit()} loading={loading} disabled={!body.trim()} />
    </Screen>
  );
}
