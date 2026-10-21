import { Button, Card, EmptyState, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { Person, SiteAssignment } from '@/data/types';
import { assignmentRank, contactLine, occupationLine, personLabel } from '@/data/walk';
import { theme } from '@/lib/theme';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

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
  const available = people.filter((candidate) => !assignedIds.has(candidate.id));
  const ordered = [...rows].sort(
    (left, right) =>
      assignmentRank(left.person?.role) - assignmentRank(right.person?.role) ||
      personLabel(left.person).localeCompare(personLabel(right.person))
  );

  return (
    <Screen>
      <Title>Assigned people</Title>
      {ordered.length === 0 ? <EmptyState title="Nobody assigned yet" /> : null}
      {ordered.map((row) => (
        <Card key={row.id}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>{personLabel(row.person)}</Text>
          {contactLine(row.person) ? <Text style={{ color: theme.muted }}>{contactLine(row.person)}</Text> : null}
          <Text style={{ color: theme.muted }}>
            {row.person ? occupationLine(row.person.role, row.person.trade) : 'Operative'}
          </Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Button
              label="Remove"
              variant="ghost"
              onPress={async () => {
                await repo.removeAssignment(row.id);
                await load();
              }}
            />
          </View>
        </Card>
      ))}
      <Text style={{ color: theme.text, fontWeight: '800' }}>Not on this site</Text>
      {available.map((candidate) => (
        <Card key={candidate.id}>
          <Text style={{ color: theme.text, fontWeight: '700' }}>{personLabel(candidate)}</Text>
          {contactLine(candidate) ? <Text style={{ color: theme.muted }}>{contactLine(candidate)}</Text> : null}
          <Text style={{ color: theme.muted }}>{occupationLine(candidate.role, candidate.trade)}</Text>
          <Button
            label="Assign to this site"
            variant="secondary"
            onPress={async () => {
              if (!siteId) return;
              await repo.addAssignment(siteId, candidate.id);
              await load();
            }}
          />
        </Card>
      ))}
    </Screen>
  );
}
