import { AppTabs } from '@/components/app-tabs';
import { Button, Card, EmptyState, Field, HeaderActions, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import type { HomeSite, PulseRow } from '@/data/types';
import { archivedRows, contractsManagerLine, operativesLine, workingRows } from '@/data/walk';
import { cacheAssignedSites, readCachedSites } from '@/lib/offline';
import { formatWhen } from '@/lib/format';
import { theme } from '@/lib/theme';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function SitesScreen() {
  const { person, signOut } = useAuth();
  const router = useRouter();
  const manager = person != null && person.role !== 'operative';
  const [rows, setRows] = useState<PulseRow[]>([]);
  const [mine, setMine] = useState<HomeSite[]>(readCachedSites());
  const [query, setQuery] = useState('');
  const [staleOnly, setStaleOnly] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (!person) return;
      let active = true;
      if (person.role === 'operative') {
        repo
          .listAssignedSites()
          .then((next) => {
            if (!active) return;
            setMine(next);
            cacheAssignedSites(next);
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
      }
      repo
        .companySitesPulse()
        .then((next) => {
          if (!active) return;
          setRows(next);
          setError('');
        })
        .catch((err: unknown) => {
          if (!active) return;
          setError(err instanceof Error ? err.message : 'Could not load sites');
        });
      return () => {
        active = false;
      };
    }, [person])
  );

  const working = useMemo(() => workingRows(rows), [rows]);
  const archived = useMemo(() => archivedRows(rows), [rows]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return working.filter((row) => {
      if (q && !row.name.toLowerCase().includes(q)) return false;
      if (openOnly && row.open_request_count < 1) return false;
      if (staleOnly) {
        if (!row.last_pack_update) return true;
        const age = Date.now() - new Date(row.last_pack_update).getTime();
        return age > 7 * 24 * 60 * 60 * 1000;
      }
      return true;
    });
  }, [working, query, staleOnly, openOnly]);

  const footer = person ? <AppTabs role={person.role} /> : null;

  if (!manager) {
    return (
      <Screen footer={footer}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Title>Sites</Title>
          <HeaderActions label="Sign out" onPress={() => void signOut()} />
        </View>
        {offline ? <Muted>Showing last synced site names. {error}</Muted> : null}
        {workingRows(mine).length === 0 && archivedRows(mine).length === 0 ? (
          <EmptyState title="You’re not on a site yet — ask your owner" />
        ) : (
          workingRows(mine).map((site) => (
            <Card key={site.id} onPress={() => router.push(`/sites/${site.id}`)}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{site.name}</Text>
              {site.address_line ? <Muted>{site.address_line}</Muted> : null}
              <Muted>{formatWhen(site.updated_at)}</Muted>
              {(site.my_open_request_count ?? 0) > 0 ? (
                <Text style={{ color: theme.open, fontWeight: '700' }}>
                  {site.my_open_request_count} open request{site.my_open_request_count === 1 ? '' : 's'} you raised
                </Text>
              ) : null}
            </Card>
          ))
        )}
        {archivedRows(mine).length > 0 ? (
          <Pressable onPress={() => setShowArchived((value) => !value)} style={{ paddingVertical: 8 }}>
            <Text style={{ color: theme.text, fontWeight: '800' }}>{showArchived ? 'Hide archived' : 'Archived'}</Text>
          </Pressable>
        ) : null}
        {showArchived
          ? archivedRows(mine).map((site) => (
              <Card key={site.id} onPress={() => router.push(`/sites/${site.id}`)}>
                <Text style={{ color: theme.archive, fontSize: 18, fontWeight: '700' }}>{site.name}</Text>
                {site.address_line ? <Muted>{site.address_line}</Muted> : null}
              </Card>
            ))
          : null}
      </Screen>
    );
  }

  return (
    <Screen footer={footer}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Title>Sites</Title>
        <HeaderActions label="Sign out" onPress={() => void signOut()} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {person.role === 'owner' ? <Button label="Create site" onPress={() => router.push('/create-site')} /> : null}
        <Button label="Invite" variant="secondary" onPress={() => router.push('/invite')} />
      </View>
      <Field label="Search sites" value={query} onChangeText={setQuery} placeholder="Oak, Riverside…" autoCapitalize="words" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => setOpenOnly((value) => !value)} style={{ paddingVertical: 8 }}>
          <Text style={{ color: openOnly ? theme.current : theme.muted, fontWeight: '700' }}>Has open requests</Text>
        </Pressable>
        <Pressable onPress={() => setStaleOnly((value) => !value)} style={{ paddingVertical: 8 }}>
          <Text style={{ color: staleOnly ? theme.current : theme.muted, fontWeight: '700' }}>Stale pack</Text>
        </Pressable>
      </View>
      {error ? <Muted>{error}</Muted> : null}
      {filtered.length === 0 && (working.length > 0 || archived.length === 0) ? (
        <EmptyState title={working.length === 0 ? 'No sites yet' : 'No sites match those filters'} />
      ) : (
        filtered.map((row) => (
          <Card key={row.site_id} onPress={() => router.push(`/sites/${row.site_id}`)}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{row.name}</Text>
            {row.address_line ? <Muted>{row.address_line}</Muted> : null}
            <Muted>{contractsManagerLine(row.contracts_manager_names)}</Muted>
            <Muted>{operativesLine(row.operative_count)}</Muted>
            <Muted>{formatWhen(row.last_pack_update)}</Muted>
            <Text style={{ color: row.open_request_count ? theme.open : theme.muted, fontWeight: '700' }}>
              {row.open_request_count} open request{row.open_request_count === 1 ? '' : 's'}
            </Text>
          </Card>
        ))
      )}
      {archived.length > 0 ? (
        <Pressable onPress={() => setShowArchived((value) => !value)} style={{ paddingVertical: 8 }}>
          <Text style={{ color: theme.text, fontWeight: '800' }}>{showArchived ? 'Hide archived' : 'Archived'}</Text>
        </Pressable>
      ) : null}
      {showArchived
        ? archived.map((row) => (
            <Card key={row.site_id} onPress={() => router.push(`/sites/${row.site_id}`)}>
              <Text style={{ color: theme.archive, fontSize: 18, fontWeight: '700' }}>{row.name}</Text>
              <Muted>{contractsManagerLine(row.contracts_manager_names)}</Muted>
              <Muted>{operativesLine(row.operative_count)}</Muted>
            </Card>
          ))
        : null}
    </Screen>
  );
}
