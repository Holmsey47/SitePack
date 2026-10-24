import { Button, Card, EmptyState, ErrorText, Screen, Title } from '@/components/ui';
import { repo } from '@/data/index';
import type { DrawingRequest } from '@/data/types';
import { markSiteListSeen } from '@/lib/siteListSeenSync';
import { timeAgo } from '@/lib/format';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

export default function SiteRequestsScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const router = useRouter();
  const [rows, setRows] = useState<DrawingRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!siteId) return;
    const next = await repo.listSiteRequests(siteId);
    setRows(next);
    setLoaded(true);
    setError('');
    await markSiteListSeen(siteId, 'requests');
  }, [siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load requests.'));
    }, [load])
  );

  return (
    <Screen>
      <Title>Requests</Title>
      <Button
        label="Request a drawing"
        minHeight={48}
        onPress={() => router.push(`/sites/${siteId}/request`)}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loaded && !error && rows.length === 0 ? <EmptyState title="No drawing requests" /> : null}
      {rows.map((row) => (
        <Card key={row.id} onPress={() => router.push(`/requests/${row.id}`)}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }} numberOfLines={2}>
            {row.body}
          </Text>
          <Text style={{ color: theme.muted }}>
            {row.requester_name ?? 'Requester'} · {timeAgo(row.created_at)}
          </Text>
          <Text
            style={{
              color: row.status === 'Open' ? theme.open : row.status === 'Sent' ? theme.sent : theme.closed,
              fontWeight: '800',
            }}>
            {row.status}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}
