import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { repo } from '@/data/index';
import type { DrawingRequest } from '@/data/types';
import { timeAgo } from '@/lib/format';
import { theme } from '@/lib/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

export default function RequestDetailScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const router = useRouter();
  const [row, setRow] = useState<DrawingRequest | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!requestId) return;
    repo.getRequest(requestId).then((next) => {
      setRow(next);
      setNote(next?.cm_note ?? '');
    });
  }, [requestId]);

  async function save(status: 'Sent' | 'Closed') {
    if (!requestId) return;
    setLoading(true);
    setError('');
    try {
      const next = await repo.updateRequest(requestId, { status, cm_note: note.trim() || null });
      setRow(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update request');
    } finally {
      setLoading(false);
    }
  }

  if (!row) {
    return (
      <Screen>
        <Muted>Loading request…</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{row.status} request</Title>
      <Muted>
        {row.site_name ?? 'Site attached'} · {row.requester_name ?? 'Requester'} · {timeAgo(row.created_at)}
      </Muted>
      <Text style={{ color: theme.text, fontSize: 17, lineHeight: 24 }}>{row.body}</Text>
      {row.sheet_hint ? <Muted>Hint: {row.sheet_hint}</Muted> : null}
      <Field label="Note (optional)" value={note} onChangeText={setNote} multiline autoCapitalize="sentences" />
      <ErrorText>{error}</ErrorText>
      <Button
        label="Attach drawing / upload"
        onPress={() => router.push(`/sites/${row.site_id}/upload`)}
      />
      <Button label="Mark sent" variant="secondary" loading={loading} onPress={() => void save('Sent')} />
      <Button label="Close" variant="ghost" loading={loading} onPress={() => void save('Closed')} />
    </Screen>
  );
}
