import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { repo } from '@/data/index';
import type { DrawingRequest } from '@/data/types';
import { timeAgo } from '@/lib/format';
import { theme } from '@/lib/theme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function RequestDetailScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const router = useRouter();
  const [row, setRow] = useState<DrawingRequest | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!requestId) return;
    repo
      .getRequest(requestId)
      .then((next) => {
        if (!next) {
          setError('Could not load the request.');
          return;
        }
        setRow(next);
        setNote(next.cm_note ?? '');
        setError('');
      })
      .catch(() => setError('Could not load the request.'));
  }, [requestId]);

  async function onDone() {
    if (!requestId) return;
    setLoading(true);
    setError('');
    try {
      await repo.updateRequest(requestId, { status: 'Closed', cm_note: note.trim() || null });
      router.replace('/requests');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update request');
      setLoading(false);
    }
  }

  async function onDelete() {
    if (!requestId) return;
    setLoading(true);
    setError('');
    try {
      await repo.deleteRequest(requestId);
      router.replace('/requests');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete request');
      setLoading(false);
    }
  }

  if (!row) {
    return (
      <Screen>
        {error ? <ErrorText>{error}</ErrorText> : <Text style={{ color: theme.muted }}>Loading request…</Text>}
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Title>Request</Title>
        <Pressable accessibilityRole="button" accessibilityLabel="Delete request" hitSlop={12} onPress={() => void onDelete()}>
          <MaterialIcons name="delete-outline" size={26} color={theme.muted} />
        </Pressable>
      </View>
      <Text style={{ color: theme.muted }}>
        {row.site_name ?? 'Site attached'} · {row.requester_name ?? 'Requester'} · {timeAgo(row.created_at)}
      </Text>
      <Text style={{ color: theme.text, fontSize: 17, lineHeight: 24 }}>{row.body}</Text>
      {row.sheet_hint ? <Text style={{ color: theme.muted }}>Hint: {row.sheet_hint}</Text> : null}
      <Field label="Note (optional)" value={note} onChangeText={setNote} multiline autoCapitalize="sentences" />
      <ErrorText>{error}</ErrorText>
      <Button label="Attach drawing / upload" variant="secondary" onPress={() => router.push(`/sites/${row.site_id}/upload`)} />
      <Button label="Done" loading={loading} onPress={() => void onDone()} />
    </Screen>
  );
}
