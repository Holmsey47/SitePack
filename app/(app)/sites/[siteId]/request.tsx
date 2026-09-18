import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { repo } from '@/data/index';
import { theme } from '@/lib/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

export default function RequestDrawingScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit() {
    if (!siteId || !body.trim()) return;
    setLoading(true);
    setError('');
    try {
      await repo.createRequest({ siteId, body: body.trim(), sheetHint: hint.trim() || null });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send request');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>Request is Open</Title>
        <Muted>This is a queue item for the CM on this site — not a chat thread. You can check status from your site list.</Muted>
        <Button label="Back to pack" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Request a drawing</Title>
      <Muted>Site is attached. Say what is missing or unclear. Optional sheet/ref hint only.</Muted>
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
      <Text style={{ color: theme.muted }}>Photo attach is Phase B follow-up — not required to send.</Text>
      <ErrorText>{error}</ErrorText>
      <Button label="Send request" onPress={() => void onSubmit()} loading={loading} disabled={!body.trim()} />
      <View />
    </Screen>
  );
}
