import { Button, Card, EmptyState, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { Person, SiteAssignment } from '@/data/types';
import { theme } from '@/lib/theme';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';

export default function AssignmentsScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const [rows, setRows] = useState<SiteAssignment[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const load = useCallback(async () => {
    if (!siteId) return;
    const [nextRows, nextPeople] = await Promise.all([repo.listAssignments(siteId), repo.listCompanyPeople()]);
    setRows(nextRows);
    setPeople(nextPeople);
  }, [siteId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (person && !canManageSite(person.role)) return <Redirect href={`/sites/${siteId}`} />;

  const assignedIds = new Set(rows.map((row) => row.person_id));
  const available = people.filter((p) => !assignedIds.has(p.id));

  return (
    <Screen>
      <Title>Assigned people</Title>
      <Muted>Who gets the current pack on this site. Operatives and CMs only see sites they are on.</Muted>
      {rows.length === 0 ? <EmptyState title="Nobody assigned yet" /> : null}
      {rows.map((row) => (
        <Card key={row.id}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>
            {row.person?.display_name ?? row.person?.email}
          </Text>
          <Muted>
            {row.person?.role}
            {row.person?.trade ? ` · ${row.person.trade}` : ''}
          </Muted>
          <Button
            label="Remove"
            variant="ghost"
            onPress={async () => {
              await repo.removeAssignment(row.id);
              await load();
            }}
          />
        </Card>
      ))}
      <Text style={{ color: theme.muted, fontWeight: '700' }}>Add from company</Text>
      {available.map((p) => (
        <Card key={p.id}>
          <Text style={{ color: theme.text, fontWeight: '700' }}>{p.display_name ?? p.email}</Text>
          <Muted>
            {p.role}
            {p.trade ? ` · ${p.trade}` : ''}
          </Muted>
          <Button
            label="Assign to this site"
            variant="secondary"
            onPress={async () => {
              if (!siteId) return;
              await repo.addAssignment(siteId, p.id);
              await load();
            }}
          />
        </Card>
      ))}
    </Screen>
  );
}
