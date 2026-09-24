import { AppTabs } from '@/components/app-tabs';
import { Card, EmptyState, ErrorText, Screen, Title } from '@/components/ui';
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
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (!person || person.role === 'operative') return;
      repo
        .listInboxRequests()
        .then((next) => {
          setRows(next);
          setLoaded(true);
          setError('');
        })
        .catch(() => {
          setError('Could not load requests.');
        });
    }, [person])
  );

  if (person?.role === 'operative') return <Redirect href="/sites" />;

  return (
    <Screen footer={person ? <AppTabs role={person.role} /> : null}>
      <Title>Drawing requests</Title>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loaded && !error && rows.length === 0 ? <EmptyState title="No drawing requests" /> : null}
      {rows.map((row) => (
        <Card key={row.id} onPress={() => router.push(`/requests/${row.id}`)}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>{row.site_name ?? 'Site'}</Text>
          <Text style={{ color: theme.muted }}>
            {row.requester_name ?? 'Requester'} · {timeAgo(row.created_at)}
          </Text>
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
