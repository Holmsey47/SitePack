import { TalkNoticeList, TalkTypeLabel } from '@/components/TalkRows';
import { Button, Card, EmptyState, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { ownSignStatus, signedCountLabel, talkError, type TalkListItem } from '@/data/talks';
import { dismissTalkNotice, getTalkQueue, retryQueuedTalk, type TalkNotice } from '@/lib/talkQueue';
import { refreshTalks } from '@/lib/talkSync';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

export default function TalksScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const manage = person ? canManageSite(person.role) : false;
  const [rows, setRows] = useState<TalkListItem[]>([]);
  const [notices, setNotices] = useState<TalkNotice[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      setRows(await repo.listTalks(siteId));
      if (person?.auth_user_id) {
        const refreshed = await refreshTalks(person.auth_user_id);
        setNotices(refreshed.notices.filter((row) => row.siteId === siteId));
      }
      setError('');
    } catch (err) {
      setError(talkError(err instanceof Error ? err.message : 'unknown'));
    }
  }, [person?.auth_user_id, siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load talks.'));
    }, [load])
  );

  return (
    <Screen>
      <Title>Inductions, talks, and RAMS</Title>
      <TalkNoticeList
        notices={notices}
        onDismiss={(notice) => {
          void dismissTalkNotice(getTalkQueue(), notice).then(() =>
            setNotices((current) => current.filter((row) => row.id !== notice.id))
          );
        }}
        onRetry={(notice) => {
          if (!notice.retryLocalId || !person?.auth_user_id) return;
          const userId = person.auth_user_id;
          void retryQueuedTalk(getTalkQueue(), notice.retryLocalId)
            .then(() => refreshTalks(userId))
            .then((next) => setNotices(next.notices.filter((row) => row.siteId === siteId)));
        }}
      />
      {error ? <Text style={{ color: theme.danger, fontSize: 16 }}>{error}</Text> : null}
      {manage ? (
        <Button label="Add a document" minHeight={56} onPress={() => router.push(`/sites/${siteId}/talks/new`)} />
      ) : null}
      {rows.length === 0 && !error ? <EmptyState title="Nothing to read yet" /> : null}
      {rows.map((row) => (
        <Card key={row.talk_id} onPress={() => router.push(`/sites/${siteId}/talks/${row.talk_id}`)}>
          <TalkTypeLabel kind={row.kind} />
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', minHeight: 48 }}>{row.title}</Text>
          <Muted>version {row.version_no}</Muted>
          {row.kind === 'rams' && row.unsigned ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: theme.text, fontWeight: '800' }}>
                {signedCountLabel(row.signed_count ?? 0, row.required_count ?? 0)}
              </Text>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>
                Not signed yet ({row.unsigned.length})
              </Text>
              {row.unsigned.map((person) => (
                <Text key={person.person_id} style={{ color: theme.text, fontSize: 17 }}>
                  {person.person_name}
                </Text>
              ))}
            </View>
          ) : row.kind === 'rams' ? (
            <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800', minHeight: 48 }}>{ownSignStatus(row.mine_signed)}</Text>
          ) : row.signed_count != null && row.required_count != null ? (
            <Text style={{ color: theme.text, fontWeight: '800' }}>{signedCountLabel(row.signed_count, row.required_count)}</Text>
          ) : (
            <Muted>{row.mine_signed ? 'Signed' : 'To read and sign'}</Muted>
          )}
        </Card>
      ))}
    </Screen>
  );
}
