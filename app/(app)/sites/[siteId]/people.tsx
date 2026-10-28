import { Button, Card, EmptyState, ErrorText, Muted, NoLoginBadge, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { SiteAssignment } from '@/data/types';
import { assignmentRank, contactLine, occupationLine, personLabel, sitePeopleOwnerName, visibleSiteOwner } from '@/data/walk';
import { textStyle } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

export default function SitePeopleScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<SiteAssignment[]>([]);
  const [ownerLabel, setOwnerLabel] = useState<{ display_name: string | null; role: 'owner' } | null>(null);
  const [error, setError] = useState('');
  const manage = person ? canManageSite(person.role) : false;

  const load = useCallback(async () => {
    if (!siteId) return;
    const [next, label] = await Promise.all([repo.listAssignments(siteId), repo.companyOwnerLabel()]);
    setRows(next);
    setOwnerLabel(label);
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
  const viewer = person ? { id: person.id, role: person.role, display_name: person.display_name } : null;
  const ownerName = sitePeopleOwnerName(ownerLabel, viewer, ordered);
  const signedInOwner = visibleSiteOwner(viewer, ordered);
  const crew = ordered.filter((row) => row.person?.role !== 'owner' && row.person_id !== signedInOwner?.id);

  return (
    <Screen>
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
      {ownerName ? (
        <Card>
          <Text style={textStyle.bodyStrong}>{ownerName}</Text>
          <Muted>Owner</Muted>
        </Card>
      ) : null}
      {crew.length === 0 && !ownerName && !error ? (
        <EmptyState icon="group" title="Nobody assigned yet" />
      ) : null}
      {crew.map((row) => (
        <Card key={row.id}>
          <Text style={textStyle.bodyStrong}>{personLabel(row.person)}</Text>
          {contactLine(row.person) ? <Muted>{contactLine(row.person)}</Muted> : null}
          <Muted>{row.person ? occupationLine(row.person.role, row.person.trade) : 'Operative'}</Muted>
          {row.person && !row.person.auth_user_id ? <NoLoginBadge /> : null}
        </Card>
      ))}
    </Screen>
  );
}
