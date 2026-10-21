import { Button, Card, ErrorText, Field, Muted, NoLoginBadge, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { occupationLine } from '@/data/companyPeople';
import { repo } from '@/data/index';
import {
  canAssignPeopleGroup,
  canEditPeopleGroup,
  groupChangeCount,
  groupFailureMessage,
  memberRowMark,
  sameMemberIds,
  saveChangesLabel,
  siteRowMark,
} from '@/data/peopleGroups';
import type { CompanyPerson, PeopleGroup, PulseRow } from '@/data/types';
import { personLabel } from '@/data/walk';
import { theme } from '@/lib/theme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';
import { Redirect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [promptOpen, setPromptOpen] = useState(false);
  const [allowLeave, setAllowLeave] = useState(false);
  const pendingAction = useRef<NavigationAction | null>(null);
  const leaveToGroups = useRef(false);
  const navigation = useNavigation();

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

  const editor = person ? canEditPeopleGroup(person.role) : false;
  const savedMemberIds = group?.members.map((member) => member.person_id) ?? [];
  const changeCount =
    editor && group
      ? groupChangeCount({
          savedName: group.name,
          draftName: name,
          savedMemberIds,
          draftMemberIds: memberIds,
        })
      : 0;
  const unsaved = changeCount > 0;

  usePreventRemove(unsaved && !allowLeave, ({ data }) => {
    pendingAction.current = data.action;
    setPromptOpen(true);
  });

  useEffect(() => {
    if (!allowLeave) return;
    if (leaveToGroups.current) {
      leaveToGroups.current = false;
      router.replace('/groups');
      return;
    }
    if (!pendingAction.current) return;
    const action = pendingAction.current;
    pendingAction.current = null;
    navigation.dispatch(action);
  }, [allowLeave, navigation, router]);

  if (person && !canAssignPeopleGroup(person.role)) return <Redirect href="/sites" />;

  const workingSites = sites;

  function toggleMember(id: string) {
    setMemberIds((current) => (current.includes(id) ? current.filter((row) => row !== id) : [...current, id]));
  }

  function toggleSite(id: string) {
    setSiteIds((current) => (current.includes(id) ? current.filter((row) => row !== id) : [...current, id]));
  }

  async function persistChanges(): Promise<boolean> {
    if (!groupId || !group) return false;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const savedName = group.name;
      const savedIds = group.members.map((member) => member.person_id);
      if (name.trim() !== savedName) await repo.renamePeopleGroup(groupId, name);
      if (!sameMemberIds(savedIds, memberIds)) await repo.setPeopleGroupMembers(groupId, memberIds);
      setNotice('Changes saved.');
      await load();
      return true;
    } catch (err) {
      setError(groupFailureMessage(err instanceof Error ? err.message : ''));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function onPromptSave() {
    const saved = await persistChanges();
    if (!saved) return;
    setPromptOpen(false);
    setAllowLeave(true);
  }

  function onDiscard() {
    setPromptOpen(false);
    setAllowLeave(true);
  }

  function onKeepEditing() {
    pendingAction.current = null;
    setPromptOpen(false);
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
      leaveToGroups.current = true;
      setAllowLeave(true);
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

  const promptName = name.trim() || group?.name || 'this group';
  const leavePrompt = promptOpen ? (
    <View
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: 'rgba(8, 10, 14, 0.86)',
        justifyContent: 'flex-end',
        padding: 16,
        gap: 12,
      }}>
      <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>Save changes to {promptName}?</Text>
      <Button label="Save" onPress={() => void onPromptSave()} loading={loading} />
      <Button label="Discard" variant="danger" onPress={onDiscard} />
      <Button label="Keep editing" variant="secondary" onPress={onKeepEditing} />
    </View>
  ) : null;
  const saveBar = unsaved ? (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
        borderTopWidth: 1,
        borderTopColor: theme.line,
        backgroundColor: theme.bg,
      }}>
      <Button label={saveChangesLabel(changeCount)} onPress={() => void persistChanges()} loading={loading} />
    </View>
  ) : null;

  if (missing) {
    return (
      <Screen>
        <EmptyMissing />
      </Screen>
    );
  }

  if (assigning && group) {
    return (
      <View style={{ flex: 1 }}>
      <Screen>
        <Title>Assign to sites</Title>
        <Muted>
          {group.name}. {memberIds.length} {memberIds.length === 1 ? 'person' : 'people'} go on every site you tick.
        </Muted>
        <ErrorText>{error}</ErrorText>
        {workingSites.map((site) => {
          const on = siteIds.includes(site.site_id);
          return (
            <MarkRow
              key={site.site_id}
              title={site.name}
              mark={siteRowMark(on)}
              on={on}
              filled={on}
              onPress={() => toggleSite(site.site_id)}
            />
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
      {leavePrompt}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
    <Screen footer={editor ? saveBar : null}>
      <Title>{group?.name ?? 'Group'}</Title>
      <ErrorText>{error}</ErrorText>
      {notice ? <Text style={{ color: theme.sent, fontWeight: '700' }}>{notice}</Text> : null}
      {editor ? (
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={40} />
      ) : (
        <Muted>The owner edits who is in this group. You can put the group on your sites.</Muted>
      )}
      <Text style={{ color: theme.text, fontWeight: '800' }}>People</Text>
      {editor
        ? people.map((row) => {
            const on = memberIds.includes(row.id);
            return (
              <MarkRow
                key={row.id}
                title={personLabel(row)}
                detail={occupationLine(row.role, row.trade)}
                mark={memberRowMark(on)}
                noLogin={!row.has_login}
                on={on}
                onPress={() => toggleMember(row.id)}
              />
            );
          })
        : (group?.members ?? []).map((member) => (
            <Card key={member.person_id}>
              <Text style={{ color: theme.text, fontWeight: '800', fontSize: 17 }}>
                {member.display_name?.trim() || 'Someone in the company'}
              </Text>
              {member.role ? <Muted>{occupationLine(member.role, member.trade)}</Muted> : <Muted>Not on your sites yet</Muted>}
              {member.has_login === false ? <NoLoginBadge /> : null}
            </Card>
          ))}
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
    {leavePrompt}
    </View>
  );
}

function MarkRow({
  title,
  detail,
  mark,
  noLogin,
  on,
  filled,
  onPress,
}: {
  title: string;
  detail?: string;
  mark: string;
  noLogin?: boolean;
  on: boolean;
  filled?: boolean;
  onPress: () => void;
}) {
  const ink = filled ? theme.currentInk : theme.text;
  const markColor = filled ? theme.currentInk : on ? theme.current : theme.muted;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ selected: on, checked: on }}
      accessibilityLabel={`${title}. ${mark}`}
      onPress={onPress}
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: on ? theme.current : theme.line,
        backgroundColor: filled ? theme.current : theme.surface,
      }}>
      <MaterialIcons name={on ? 'check-circle' : 'radio-button-unchecked'} size={28} color={markColor} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: ink, fontWeight: '800', fontSize: 17 }}>{title}</Text>
        {detail ? <Text style={{ color: filled ? theme.currentInk : theme.muted }}>{detail}</Text> : null}
        {noLogin ? <NoLoginBadge /> : null}
        <Text style={{ color: markColor, fontWeight: '800', fontSize: 16 }}>{mark}</Text>
      </View>
    </Pressable>
  );
}

function EmptyMissing() {
  return (
    <View>
      <Title>That group is not in the company</Title>
    </View>
  );
}
