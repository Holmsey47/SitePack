import { Button, Card, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { occupationLine } from '@/data/companyPeople';
import { repo } from '@/data/index';
import { canAssignPeopleGroup, canEditPeopleGroup, groupFailureMessage } from '@/data/peopleGroups';
import type { CompanyPerson, PeopleGroup, PulseRow } from '@/data/types';
import { personLabel } from '@/data/walk';
import { theme } from '@/lib/theme';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function GroupScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [group, setGroup] = useState<PeopleGroup | null>(null);
  const [people, setPeople] = useState<CompanyPerson[]>([]);
  const [sites, setSites] = useState<PulseRow[]>([]);
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!groupId) return;
    const [groups, nextPeople, nextSites] = await Promise.all([
      repo.listPeopleGroups(),
      repo.companyPeople(),
      repo.companySitesPulse(),
    ]);
    const found = groups.find((row) => row.id === groupId) ?? null;
    setGroup(found);
    setPeople(nextPeople);
    setSites(nextSites.filter((site) => !site.archived_at));
    if (found) {
      setName(found.name);
      setMemberIds(found.members.map((member) => member.person_id));
    }
    setMissing(!found);
    setError('');
  }, [groupId]);

  useEffect(() => {
    if (!person || !canAssignPeopleGroup(person.role)) return;
    load().catch((err: unknown) => {
      setError(groupFailureMessage(err instanceof Error ? err.message : ''));
    });
  }, [load, person]);

  if (person && !canAssignPeopleGroup(person.role)) return <Redirect href="/sites" />;

  const editor = person ? canEditPeopleGroup(person.role) : false;
  const workingSites = sites;

  function toggleMember(id: string) {
    setMemberIds((current) => (current.includes(id) ? current.filter((row) => row !== id) : [...current, id]));
  }

  function toggleSite(id: string) {
    setSiteIds((current) => (current.includes(id) ? current.filter((row) => row !== id) : [...current, id]));
  }

  async function onRename() {
    if (!groupId) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await repo.renamePeopleGroup(groupId, name);
      setNotice('Name saved.');
      await load();
    } catch (err) {
      setError(groupFailureMessage(err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  }

  async function onSaveMembers() {
    if (!groupId) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await repo.setPeopleGroupMembers(groupId, memberIds);
      setNotice('People saved.');
      await load();
    } catch (err) {
      setError(groupFailureMessage(err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  }

  async function onDelete() {
    if (!groupId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setLoading(true);
    setError('');
    try {
      await repo.deletePeopleGroup(groupId);
      router.replace('/groups');
    } catch (err) {
      setError(groupFailureMessage(err instanceof Error ? err.message : ''));
      setLoading(false);
    }
  }

  async function onAssign() {
    if (!groupId) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await repo.assignGroupToSites(groupId, siteIds);
      setNotice(
        result.added === 0
          ? 'Everyone in the group was already on those sites.'
          : `Added ${result.added} ${result.added === 1 ? 'person' : 'people'} to those sites.`
      );
      setAssigning(false);
      setSiteIds([]);
    } catch (err) {
      setError(groupFailureMessage(err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  }

  if (missing) {
    return (
      <Screen>
        <EmptyMissing />
      </Screen>
    );
  }

  if (assigning && group) {
    return (
      <Screen>
        <Title>Assign to sites</Title>
        <Muted>
          {group.name}. {memberIds.length} {memberIds.length === 1 ? 'person' : 'people'} go on every site you tick.
        </Muted>
        <ErrorText>{error}</ErrorText>
        {workingSites.map((site) => {
          const on = siteIds.includes(site.site_id);
          return (
            <Pressable
              key={site.site_id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => toggleSite(site.site_id)}
              style={{
                minHeight: 48,
                justifyContent: 'center',
                paddingHorizontal: 14,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: on ? theme.current : theme.line,
                backgroundColor: on ? theme.current : theme.surface,
              }}>
              <Text style={{ color: on ? theme.currentInk : theme.text, fontWeight: '800', fontSize: 17 }}>
                {site.name}
              </Text>
            </Pressable>
          );
        })}
        <Button
          label={siteIds.length === 0 ? 'Choose sites' : `Assign to ${siteIds.length} ${siteIds.length === 1 ? 'site' : 'sites'}`}
          onPress={() => void onAssign()}
          loading={loading}
          disabled={siteIds.length === 0}
        />
        <Button label="Back" variant="ghost" onPress={() => setAssigning(false)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{group?.name ?? 'Group'}</Title>
      <ErrorText>{error}</ErrorText>
      {notice ? <Text style={{ color: theme.sent, fontWeight: '700' }}>{notice}</Text> : null}
      {editor ? (
        <>
          <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={40} />
          <Button label="Save name" variant="secondary" onPress={() => void onRename()} loading={loading} disabled={!name.trim()} />
        </>
      ) : (
        <Muted>The owner edits who is in this group. You can put the group on your sites.</Muted>
      )}
      <Text style={{ color: theme.text, fontWeight: '800' }}>People</Text>
      {editor
        ? people.map((row) => {
            const on = memberIds.includes(row.id);
            return (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => toggleMember(row.id)}
                style={{
                  minHeight: 48,
                  justifyContent: 'center',
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: on ? theme.current : theme.line,
                }}>
                <Text style={{ color: theme.text, fontWeight: '800', fontSize: 17 }}>{personLabel(row)}</Text>
                <Text style={{ color: theme.muted }}>
                  {occupationLine(row.role, row.trade)} · {row.has_login ? 'Has a login' : 'No login'}
                </Text>
              </Pressable>
            );
          })
        : (group?.members ?? []).map((member) => (
            <Card key={member.person_id}>
              <Text style={{ color: theme.text, fontWeight: '800', fontSize: 17 }}>
                {member.display_name?.trim() || 'Someone in the company'}
              </Text>
              {member.role ? (
                <Muted>
                  {occupationLine(member.role, member.trade)}
                  {member.has_login === false ? ' · No login' : ''}
                </Muted>
              ) : (
                <Muted>Not on your sites yet</Muted>
              )}
            </Card>
          ))}
      {editor ? (
        <Button label="Save people" onPress={() => void onSaveMembers()} loading={loading} />
      ) : null}
      <Button label="Assign to sites" variant="secondary" onPress={() => setAssigning(true)} />
      {editor ? (
        <Button
          label={confirmDelete ? 'Delete this group' : 'Delete group'}
          variant="danger"
          onPress={() => void onDelete()}
          loading={loading}
        />
      ) : null}
      {editor && confirmDelete ? <Muted>People stay in the company. Sites they are already on stay as they are.</Muted> : null}
    </Screen>
  );
}

function EmptyMissing() {
  return (
    <View>
      <Title>That group is not in the company</Title>
    </View>
  );
}
