import { Button, Card, EmptyState, HeaderActions, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import type { HomeSite } from '@/data/types';
import { cacheAssignedSites, readCachedSites } from '@/lib/offline';
import { formatWhen } from '@/lib/format';
import { theme } from '@/lib/theme';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

export default function HomeScreen() {
  const { person, signOut, usingFixtures } = useAuth();
  const router = useRouter();
  const [sites, setSites] = useState<HomeSite[]>(readCachedSites());
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      repo
        .listAssignedSites()
        .then((rows) => {
          if (!active) return;
          setSites(rows);
          cacheAssignedSites(rows);
          setOffline(false);
          setError('');
        })
        .catch((err: unknown) => {
          if (!active) return;
          setOffline(true);
          setError(err instanceof Error ? err.message : 'Could not refresh sites');
        });
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Title>Your sites</Title>
          <Muted>
            {person?.display_name}
            {person?.trade ? ` · ${person.trade}` : ''} · assigned only
          </Muted>
        </View>
        <HeaderActions label="Sign out" onPress={() => void signOut()} />
      </View>
      {person && person.role !== 'operative' ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button label="Pulse" variant="secondary" onPress={() => router.push('/sites')} />
          <Button label="Requests" variant="secondary" onPress={() => router.push('/requests')} />
          {person.role === 'owner' ? <Button label="Invite" variant="secondary" onPress={() => router.push('/invite')} /> : null}
        </View>
      ) : null}
      {usingFixtures ? <Muted>Running on local seed (no Supabase URL). Same screens as live.</Muted> : null}
      {offline ? <Muted>Showing last synced site names. {error}</Muted> : null}
      {sites.length === 0 ? (
        <EmptyState title="You’re not on a site yet — ask your owner" />
      ) : (
        sites.map((site) => (
          <Card key={site.id} onPress={() => router.push(`/sites/${site.id}`)}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{site.name}</Text>
            {site.address_line ? <Muted>{site.address_line}</Muted> : null}
            <Muted>{formatWhen(site.updated_at)}</Muted>
            {(site.my_open_request_count ?? 0) > 0 ? (
              <Text style={{ color: theme.open, fontWeight: '700' }}>
                {site.my_open_request_count} open request{site.my_open_request_count === 1 ? '' : 's'} you raised
              </Text>
            ) : null}
            {person?.role !== 'operative' && (site.open_request_count ?? 0) > 0 ? (
              <Text style={{ color: theme.open, fontWeight: '700' }}>{site.open_request_count} open on this site</Text>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
