import { Button, Card, EmptyState, ErrorText, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { groupFailureMessage } from '@/data/peopleGroups';
import { canManageSite } from '@/data/repo';
import type { PeopleGroup, Person, SiteAssignment } from '@/data/types';
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
  const [groups, setGroups] = useState<PeopleGroup[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!siteId) return;
    const [nextRows, nextPeople, nextGroups] = await Promise.all([
      repo.listAssignments(siteId),
      repo.listCompanyPeople(),
      repo.listPeopleGroups(),
    ]);
    setRows(nextRows);
    setPeople(nextPeople);
    setGroups(nextGroups);
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

  async function onAddGroup(groupId: string) {
    if (!siteId) return;
    setError('');
    setNotice('');
    try {
      const result = await repo.assignGroupToSites(groupId, [siteId]);
      setNotice(
        result.added === 0 ? 'That group is already on this site.' : `Added ${result.added} from the group.`
      );
      await load();
    } catch (err) {
      setError(groupFailureMessage(err instanceof Error ? err.message : ''));
    }
  }

  async function onRemoveGroup(groupId: string) {
    if (!siteId) return;
    setError('');
    setNotice('');
    try {
      const result = await repo.removeGroupFromSite(groupId, siteId);
      setNotice(`Removed ${result.removed} from this site.`);
      await load();
    } catch (err) {
      setError(groupFailureMessage(err instanceof Error ? err.message : ''));
    }
  }

  return (
    <Screen>
      <Title>Assigned people</Title>
      <ErrorText>{error}</ErrorText>
      {notice ? <Text style={{ color: theme.sent, fontWeight: '700' }}>{notice}</Text> : null}
      {ordered.length === 0 ? <EmptyState title="Nobody assigned yet" /> : null}
      {ordered.map((row) => (
        <Card key={row.id}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>{personLabel(row.person)}</Text>
          {contactLine(row.person) ? <Text style={{ color: theme.muted }}>{contactLine(row.person)}</Text> : null}
          <Text style={{ color: theme.muted }}>
            {row.person ? occupationLine(row.person.role, row.person.trade) : 'Operative'}
            {row.person && !row.person.auth_user_id ? ' · No login' : ''}
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
      {groups.length > 0 ? <Text style={{ color: theme.text, fontWeight: '800' }}>Groups</Text> : null}
      {groups.map((group) => (
        <Card key={group.id}>
          <Text style={{ color: theme.text, fontWeight: '800', fontSize: 17 }}>{group.name}</Text>
          <Muted>
            {group.members.length} {group.members.length === 1 ? 'person' : 'people'}
          </Muted>
          <Button label={`Add ${group.name}`} variant="secondary" onPress={() => void onAddGroup(group.id)} />
          <Button label={`Remove ${group.name}`} variant="ghost" onPress={() => void onRemoveGroup(group.id)} />
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
