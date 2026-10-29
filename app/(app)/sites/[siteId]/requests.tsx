import { Button, Card, EmptyState, ErrorText, Screen } from '@/components/ui';
import { repo } from '@/data/index';
import type { DrawingRequest } from '@/data/types';
import { markSiteListSeen } from '@/lib/siteListSeenSync';
import { timeAgo } from '@/lib/format';
import { textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

export default function SiteRequestsScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const router = useRouter();
  const [rows, setRows] = useState<DrawingRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!siteId) return;
    const seen = markSiteListSeen(siteId, 'requests');
    const next = await repo.listSiteRequests(siteId);
    setRows(next);
    setLoaded(true);
    setError('');
    await seen;
  }, [siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load requests.'));
    }, [load])
  );

  return (
    <Screen>
      <Button
        label="Request a drawing"
        minHeight={48}
        onPress={() => router.push(`/sites/${siteId}/request`)}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loaded && !error && rows.length === 0 ? (
        <EmptyState icon="assignment" title="Drawing requests for this site show up here" />
      ) : null}
      {rows.map((row) => (
        <Card key={row.id} onPress={() => router.push(`/requests/${row.id}`)}>
          <Text style={textStyle.bodyStrong} numberOfLines={2}>
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
