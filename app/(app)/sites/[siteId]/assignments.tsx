import { Button, Card, EmptyState, ErrorText, Muted, NoLoginBadge, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { groupFailureMessage } from '@/data/peopleGroups';
import { canManageSite } from '@/data/repo';
import type { PeopleGroup, Person, SiteAssignment } from '@/data/types';
import { assignmentRank, contactLine, occupationLine, personLabel } from '@/data/walk';
import { textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

export default function AssignmentsScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const [rows, setRows] = useState<SiteAssignment[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [groups, setGroups] = useState<PeopleGroup[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmPerson, setConfirmPerson] = useState<string | null>(null);

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
      <ErrorText>{error}</ErrorText>
      {notice ? <Text style={{ color: theme.sent, fontWeight: '700' }}>{notice}</Text> : null}
      {ordered.length === 0 ? <EmptyState icon="group" title="Nobody assigned yet" /> : null}
      {ordered.map((row) => (
        <Card key={row.id}>
          <Text style={textStyle.bodyStrong}>{personLabel(row.person)}</Text>
          {contactLine(row.person) ? <Text style={{ color: theme.muted }}>{contactLine(row.person)}</Text> : null}
          <Text style={{ color: theme.muted }}>
            {row.person ? occupationLine(row.person.role, row.person.trade) : 'Operative'}
          </Text>
          {row.person && !row.person.auth_user_id ? <NoLoginBadge /> : null}
          <View style={{ alignItems: 'flex-end' }}>
            {confirmPerson === row.id ? (
              <>
                <Text style={textStyle.body}>Remove {personLabel(row.person)} from this site?</Text>
                <Button
                  label="Remove"
                  variant="danger"
                  onPress={async () => {
                    await repo.removeAssignment(row.id);
                    setConfirmPerson(null);
                    await load();
                  }}
                />
              </>
            ) : (
              <Button label="Remove" variant="ghost" onPress={() => setConfirmPerson(row.id)} />
            )}
          </View>
        </Card>
      ))}
      {groups.length > 0 ? <Text style={{ color: theme.text, fontWeight: '800' }}>Groups</Text> : null}
      {groups.map((group) => (
        <Card key={group.id}>
          <Text style={{ ...textStyle.bodyStrong }}>{group.name}</Text>
          <Muted>
            {group.members.length} {group.members.length === 1 ? 'person' : 'people'}
          </Muted>
          <Button label={`Add ${group.name}`} variant="secondary" onPress={() => void onAddGroup(group.id)} />
          {confirmRemove === group.id ? (
            <Muted>Takes off people this gang put on the site. People you added by hand stay.</Muted>
          ) : null}
          <Button
            label={confirmRemove === group.id ? `Remove ${group.name} from this site` : `Remove ${group.name}`}
            variant="ghost"
            onPress={() => {
              if (confirmRemove !== group.id) {
                setConfirmRemove(group.id);
                return;
              }
              void onRemoveGroup(group.id);
            }}
          />
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
