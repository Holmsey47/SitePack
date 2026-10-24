import { Button, Card, EmptyState, ErrorText, Muted, NoLoginBadge, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { SiteAssignment } from '@/data/types';
import { assignmentRank, contactLine, occupationLine, personLabel } from '@/data/walk';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

export default function SitePeopleScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<SiteAssignment[]>([]);
  const [error, setError] = useState('');
  const manage = person ? canManageSite(person.role) : false;

  const load = useCallback(async () => {
    if (!siteId) return;
    const next = await repo.listAssignments(siteId);
    setRows(next);
    setError('');
  }, [siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load people on this site.'));
    }, [load])
  );

  const ordered = [...rows].sort(
    (left, right) =>
      assignmentRank(left.person?.role) - assignmentRank(right.person?.role) ||
      personLabel(left.person).localeCompare(personLabel(right.person))
  );

  return (
    <Screen>
      <Title>People</Title>
      <ErrorText>{error}</ErrorText>
      {manage ? (
        <View style={{ gap: 8 }}>
          <Button
            label="Invite to this site"
            minHeight={48}
            onPress={() => router.push(`/sites/${siteId}/invite-code`)}
          />
          <Button
            label="Assigned people"
            variant="secondary"
            minHeight={48}
            onPress={() => router.push(`/sites/${siteId}/assignments`)}
          />
        </View>
      ) : null}
      {ordered.length === 0 && !error ? <EmptyState title="Nobody assigned yet" /> : null}
      {ordered.map((row) => (
        <Card key={row.id}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>{personLabel(row.person)}</Text>
          {contactLine(row.person) ? <Muted>{contactLine(row.person)}</Muted> : null}
          <Muted>{row.person ? occupationLine(row.person.role, row.person.trade) : 'Operative'}</Muted>
          {row.person && !row.person.auth_user_id ? <NoLoginBadge /> : null}
        </Card>
      ))}
    </Screen>
  );
}
