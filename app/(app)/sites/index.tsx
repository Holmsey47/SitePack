import { Button, Card, EmptyState, Field, HeaderActions, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import type { PulseRow } from '@/data/types';
import { formatWhen } from '@/lib/format';
import { theme } from '@/lib/theme';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function PulseScreen() {
  const { person, signOut } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<PulseRow[]>([]);
  const [query, setQuery] = useState('');
  const [staleOnly, setStaleOnly] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (!person || person.role === 'operative') return;
      repo
        .companySitesPulse()
        .then(setRows)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load pulse'));
    }, [person])
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (q && !row.name.toLowerCase().includes(q)) return false;
      if (openOnly && row.open_request_count < 1) return false;
      if (staleOnly) {
        if (!row.last_pack_update) return true;
        const age = Date.now() - new Date(row.last_pack_update).getTime();
        return age > 7 * 24 * 60 * 60 * 1000;
      }
      return true;
    });
  }, [rows, query, staleOnly, openOnly]);

  if (person?.role === 'operative') return <Redirect href="/home" />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Title>Pulse</Title>
          <Muted>
            {person?.role === 'owner' ? 'All company sites' : 'Assigned sites only'} · pack age and open asks
          </Muted>
        </View>
        <HeaderActions label="Sign out" onPress={() => void signOut()} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {person?.role === 'cm' ? <Button label="My sites" variant="secondary" onPress={() => router.push('/home')} /> : null}
        <Button label="Requests" variant="secondary" onPress={() => router.push('/requests')} />
        <Button label="Invite" variant="secondary" onPress={() => router.push('/invite')} />
      </View>
      <Field label="Search sites" value={query} onChangeText={setQuery} placeholder="Oak, Riverside…" autoCapitalize="words" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => setOpenOnly((v) => !v)} style={{ paddingVertical: 8 }}>
          <Text style={{ color: openOnly ? theme.current : theme.muted, fontWeight: '700' }}>Has open requests</Text>
        </Pressable>
        <Pressable onPress={() => setStaleOnly((v) => !v)} style={{ paddingVertical: 8 }}>
          <Text style={{ color: staleOnly ? theme.current : theme.muted, fontWeight: '700' }}>Stale pack</Text>
        </Pressable>
      </View>
      {error ? <Muted>{error}</Muted> : null}
      {filtered.length === 0 ? (
        <EmptyState title={rows.length === 0 ? 'No sites yet' : 'No sites match those filters'} />
      ) : (
        filtered.map((row) => {
          const extra = Math.max(0, row.assignee_count - row.assignee_names_preview.length);
          return (
            <Card key={row.site_id} onPress={() => router.push(`/sites/${row.site_id}`)}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{row.name}</Text>
              {row.address_line ? <Muted>{row.address_line}</Muted> : null}
              <Muted>
                {row.assignee_count} assigned
                {row.assignee_names_preview.length ? ` · ${row.assignee_names_preview.join(', ')}` : ''}
                {extra > 0 ? ` +${extra}` : ''}
              </Muted>
              <Muted>{formatWhen(row.last_pack_update)}</Muted>
              <Text style={{ color: row.open_request_count ? theme.open : theme.muted, fontWeight: '700' }}>
                {row.open_request_count} open request{row.open_request_count === 1 ? '' : 's'}
              </Text>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
