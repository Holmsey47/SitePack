import { Button, Card, EmptyState, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { signedCountLabel, talkError, type TalkListItem } from '@/data/talks';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

export default function TalksScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const manage = person ? canManageSite(person.role) : false;
  const [rows, setRows] = useState<TalkListItem[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      setRows(await repo.listTalks(siteId));
      setError('');
    } catch (err) {
      setError(talkError(err instanceof Error ? err.message : 'unknown'));
    }
  }, [siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load talks.'));
    }, [load])
  );

  return (
    <Screen>
      <Title>Inductions and talks</Title>
      {error ? <Text style={{ color: theme.danger, fontSize: 16 }}>{error}</Text> : null}
      {manage ? (
        <Button label="Create a talk" minHeight={56} onPress={() => router.push(`/sites/${siteId}/talks/new`)} />
      ) : null}
      {rows.length === 0 && !error ? <EmptyState title="Nothing to read yet" /> : null}
      {rows.map((row) => (
        <Card key={row.talk_id} onPress={() => router.push(`/sites/${siteId}/talks/${row.talk_id}`)}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', minHeight: 48 }}>{row.title}</Text>
          <Muted>
            {row.kind === 'induction' ? 'Induction' : 'Toolbox talk'} · version {row.version_no}
          </Muted>
          {row.signed_count != null && row.required_count != null ? (
            <Text style={{ color: theme.text, fontWeight: '800' }}>{signedCountLabel(row.signed_count, row.required_count)}</Text>
          ) : (
            <Muted>{row.mine_signed ? 'Signed' : 'To read and sign'}</Muted>
          )}
        </Card>
      ))}
    </Screen>
  );
}
