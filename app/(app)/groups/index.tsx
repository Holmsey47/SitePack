import { AppTabs } from '@/components/app-tabs';
import { Button, Card, EmptyState, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canAssignPeopleGroup, canEditPeopleGroup, groupFailureMessage } from '@/data/peopleGroups';
import type { PeopleGroup } from '@/data/types';
import { textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';

export default function GroupsScreen() {
  const { person } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<PeopleGroup[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const next = await repo.listPeopleGroups();
    setGroups(next);
    setLoaded(true);
    setError('');
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!person || !canAssignPeopleGroup(person.role)) return;
      load().catch((err: unknown) => {
        setError(groupFailureMessage(err instanceof Error ? err.message : ''));
      });
    }, [load, person])
  );

  if (person && !canAssignPeopleGroup(person.role)) return <Redirect href="/sites" />;

  const editor = person ? canEditPeopleGroup(person.role) : false;

  async function onCreate() {
    setLoading(true);
    setError('');
    try {
      const id = await repo.createPeopleGroup(name);
      setName('');
      router.push(`/groups/${id}`);
    } catch (err) {
      setError(groupFailureMessage(err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen footer={person ? <AppTabs role={person.role} /> : null}>
      <Muted>A group puts the same people on a site in one go. It does not change who can see a site.</Muted>
      <ErrorText>{error}</ErrorText>
      {!loaded && !error ? <Muted>Loading groups…</Muted> : null}
      {loaded && groups.length === 0 ? <EmptyState icon="group" title="No groups yet" /> : null}
      {groups.map((group) => (
        <Pressable
          key={group.id}
          accessibilityRole="button"
          onPress={() => router.push(`/groups/${group.id}`)}
          style={{ minHeight: 48 }}>
          <Card>
            <Text style={{ ...textStyle.bodyStrong }}>{group.name}</Text>
            <Muted>
              {group.members.length} {group.members.length === 1 ? 'person' : 'people'}
            </Muted>
          </Card>
        </Pressable>
      ))}
      {editor ? (
        <>
          <Title>New group</Title>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            placeholder="Oak dryliners"
            maxLength={40}
          />
          <Button label="Create group" onPress={() => void onCreate()} loading={loading} disabled={!name.trim()} />
        </>
      ) : null}
    </Screen>
  );
}
