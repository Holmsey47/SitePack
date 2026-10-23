import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { attendanceError, canManageHours, forgotLine, gapLine, shiftCard, type AttendanceEntry } from '@/data/attendance';
import { repo } from '@/data/index';
import { formatUkDateTime } from '@/lib/format';
import { londonLocalInput, parseLondonLocal } from '@/lib/attendanceHours';
import { theme } from '@/lib/theme';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';

export default function AttendanceEntryScreen() {
  const { entryId } = useLocalSearchParams<{ entryId: string }>();
  const { person } = useAuth();
  const manage = person ? canManageHours(person.role) : false;
  const [entry, setEntry] = useState<AttendanceEntry | null>(null);
  const [signedIn, setSignedIn] = useState('');
  const [signedOut, setSignedOut] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!entryId) return;
    try {
      const next = await repo.attendanceEntry(entryId);
      setEntry(next);
      setSignedIn(londonLocalInput(next?.in_at));
      setSignedOut(londonLocalInput(next?.out_at));
      setError(next ? '' : 'That entry is not on your sites.');
    } catch (err) {
      setError(attendanceError(err));
    }
  }, [entryId]);

  useEffect(() => {
    load().catch(() => setError('Could not load the entry.'));
  }, [load]);

  async function onSave() {
    if (!entryId || !reason.trim()) {
      setError('A reason is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await repo.correctAttendance(entryId, parseLondonLocal(signedIn), parseLondonLocal(signedOut), reason.trim());
      setEntry(next);
      setSaved(true);
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  const card = entry ? shiftCard(entry) : null;

  return (
    <Screen>
      <Title>{entry?.person_name ?? 'Hours'}</Title>
      {entry && card ? (
        <>
          <Muted>Signed in {formatUkDateTime(entry.in_at)}</Muted>
          <Muted>{entry.out_at ? `Signed out ${formatUkDateTime(entry.out_at)}` : 'Still signed in'}</Muted>
          {card.correction ? (
            <>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', lineHeight: 22 }}>{card.correction}</Text>
              {card.reason ? <Text style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>{card.reason}</Text> : null}
              {card.flags.map((flag) => (
                <Text key={flag} style={{ color: theme.text, fontWeight: '800' }}>
                  {flag}
                </Text>
              ))}
            </>
          ) : (
            <>
              {gapLine(entry) ? <Text style={{ color: theme.text, fontWeight: '800' }}>{gapLine(entry)}</Text> : null}
              {forgotLine(entry) ? <Text style={{ color: theme.text, fontWeight: '800' }}>{forgotLine(entry)}</Text> : null}
              {entry.late_sign_out && entry.late_out_at ? (
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800', lineHeight: 22 }}>
                  Late sign-out {formatUkDateTime(entry.late_out_at)}
                  {entry.late_out_device_at ? `. Phone ${formatUkDateTime(entry.late_out_device_at)}` : ''}. The hours stay at 23:59 until you
                  correct them.
                </Text>
              ) : null}
            </>
          )}
          {entry.audit?.map((row) => (
            <Text key={row.id} style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>
              {row.corrected_by_name}: {row.reason}. Before {formatUkDateTime(String(row.before_entry.in_at ?? ''))}
              {' – '}
              {row.before_entry.out_at ? formatUkDateTime(String(row.before_entry.out_at)) : 'open'}. After{' '}
              {formatUkDateTime(String(row.after_entry.in_at ?? ''))}
              {' – '}
              {formatUkDateTime(String(row.after_entry.out_at ?? ''))}.
            </Text>
          ))}
        </>
      ) : null}
      {manage && entry && !saved ? (
        <>
          <Field label="Signed in" value={signedIn} onChangeText={setSignedIn} placeholder="2026-10-22 08:00" autoCapitalize="none" />
          <Field label="Signed out" value={signedOut} onChangeText={setSignedOut} placeholder="2026-10-22 16:30" autoCapitalize="none" />
          <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Why this change" autoCapitalize="sentences" />
          <Button label="Save correction" minHeight={56} loading={busy} disabled={reason.trim().length < 1} onPress={() => void onSave()} />
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
