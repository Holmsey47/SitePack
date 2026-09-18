import { Card, EmptyState, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import type { DrawingRequest } from '@/data/types';
import { timeAgo } from '@/lib/format';
import { theme } from '@/lib/theme';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

export default function RequestsInboxScreen() {
  const { person } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<DrawingRequest[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!person || person.role === 'operative') return;
      repo.listInboxRequests().then(setRows).catch(() => setRows([]));
    }, [person])
  );

  if (person?.role === 'operative') return <Redirect href="/home" />;

  return (
    <Screen>
      <Title>Drawing requests</Title>
      <Muted>
        {person?.role === 'owner' ? 'All company sites' : 'Only sites you are assigned to'} · queue, not chat
      </Muted>
      {rows.length === 0 ? <EmptyState title="No drawing requests" /> : null}
      {rows.map((row) => (
        <Card key={row.id} onPress={() => router.push(`/requests/${row.id}`)}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>{row.site_name ?? 'Site'}</Text>
          <Muted>
            {row.requester_name ?? 'Requester'} · {timeAgo(row.created_at)}
          </Muted>
          <Text style={{ color: theme.text }} numberOfLines={2}>
            {row.body}
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
