import { InductionWarning } from '@/components/TalkRows';
import { Button, Card, EmptyState, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { attendanceError, canManageHours, forgotLine, gapLine, type AttendanceEntry, type OnSiteNow } from '@/data/attendance';
import { repo } from '@/data/index';
import { formatUkDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

export default function AttendanceScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const manage = person ? canManageHours(person.role) : false;
  const [live, setLive] = useState<OnSiteNow | null>(null);
  const [mine, setMine] = useState<AttendanceEntry[]>([]);
  const [inductionNames, setInductionNames] = useState<string[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const [now, history] = await Promise.all([
        manage ? repo.listOnSiteNow(siteId) : Promise.resolve(null),
        repo.listMyAttendance(siteId),
      ]);
      setLive(now);
      setMine(history);
      if (manage) {
        const gaps = await repo.inductionSignInGaps(siteId).catch(() => null);
        setInductionNames(gaps?.map((row) => row.person_name) ?? []);
      } else setInductionNames([]);
      setError('');
    } catch (err) {
      setError(attendanceError(err instanceof Error ? err.message : 'unknown'));
    }
  }, [manage, siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load hours.'));
    }, [load])
  );

  const showSite = manage && live != null;

  return (
    <Screen>
      <Title>{showSite ? 'On site now' : 'My hours'}</Title>
      {showSite ? <InductionWarning names={inductionNames} /> : null}
      {error ? <Text style={{ color: theme.danger, fontSize: 16 }}>{error}</Text> : null}
      {showSite && live.rows.length === 0 ? <EmptyState title="Nobody is signed in" /> : null}
      {showSite
        ? live.rows.map((row) => (
            <Card key={row.entry_id} onPress={() => router.push(`/sites/${siteId}/attendance/${row.entry_id}`)}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', minHeight: 48 }}>{row.person_name}</Text>
              <Muted>Signed in {formatUkDateTime(row.in_at)}</Muted>
              {row.in_gap ? <Text style={{ color: theme.text, fontWeight: '800' }}>Phone time was more than 10 minutes out</Text> : null}
            </Card>
          ))
        : null}
      {!showSite && mine.length === 0 ? <EmptyState title="No hours yet" /> : null}
      {!showSite
        ? mine.map((row) => (
            <Card key={row.entry_id} onPress={() => router.push(`/sites/${siteId}/attendance/${row.entry_id}`)}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', minHeight: 48 }}>
                {formatUkDateTime(row.in_at)}
                {row.out_at ? ` – ${formatUkDateTime(row.out_at)}` : ' · still in'}
              </Text>
              {gapLine(row) ? <Muted>{gapLine(row)}</Muted> : null}
              {forgotLine(row) ? <Text style={{ color: theme.text, fontWeight: '800' }}>{forgotLine(row)}</Text> : null}
            </Card>
          ))
        : null}
      {showSite ? (
        <Button label="Weekly hours" minHeight={56} onPress={() => router.push(`/sites/${siteId}/attendance/week`)} />
      ) : null}
    </Screen>
  );
}
