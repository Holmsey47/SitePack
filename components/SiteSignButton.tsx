import { SeenRejectNotice } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import type { MySiteAttendance } from '@/data/attendance';
import { attendanceError } from '@/data/attendance';
import { clientNowIso, LATE_SIGN_OUT_NOTICE } from '@/lib/attendanceHours';
import { formatUkDateTime } from '@/lib/format';
import {
  flushAttendanceQueue,
  getAttendanceQueue,
  persistThenSendAttendance,
  SAVED_ON_PHONE,
  stateAfterQueue,
  type AttendanceNotice,
  type QueuedTap,
} from '@/lib/attendanceQueue';
import { deviceIsOnline } from '@/lib/variationQueue';
import { theme } from '@/lib/theme';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

async function sendTap(item: QueuedTap) {
  if (item.action === 'in') {
    await repo.signInSite(item.siteId, item.deviceAt);
    return;
  }
  const entry = await repo.signOutSite(item.siteId, item.deviceAt);
  if (entry.late_sign_out) {
    await getAttendanceQueue().putNotice({
      id: `late:${item.localId}`,
      userId: item.userId,
      siteId: item.siteId,
      message: LATE_SIGN_OUT_NOTICE,
    });
  }
}

export function SiteSignButton({ siteId }: { siteId: string }) {
  const { person } = useAuth();
  const userId = person?.auth_user_id ?? '';
  const [server, setServer] = useState<MySiteAttendance | null>(null);
  const [queued, setQueued] = useState<QueuedTap[]>([]);
  const [notices, setNotices] = useState<AttendanceNotice[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!siteId || !userId) return;
    const queue = getAttendanceQueue();
    if (await deviceIsOnline()) {
      await flushAttendanceQueue(queue, userId, sendTap).catch(() => undefined);
    }
    const pending = (await queue.list()).filter((item) => item.userId === userId && item.siteId === siteId);
    const notes = (await queue.listNotices()).filter((item) => item.userId === userId && item.siteId === siteId);
    setQueued(pending);
    setNotices(notes);
    try {
      setServer(await repo.mySiteAttendance(siteId));
      setError('');
    } catch (err) {
      setError(attendanceError(err instanceof Error ? err.message : 'unknown'));
    }
  }, [siteId, userId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load sign-in.'));
    }, [load])
  );

  if (!userId) return null;

  const shown = stateAfterQueue(server?.state ?? 'out', queued);
  const since = server?.state === 'in' && shown === 'in' ? server.entry?.in_at : null;

  async function onPress() {
    if (busy) return;
    setBusy(true);
    setError('');
    const deviceAt = clientNowIso();
    const action = shown === 'in' ? 'out' : 'in';
    const item: QueuedTap = {
      localId: `${action}:${siteId}:${deviceAt}`,
      userId,
      siteId,
      action,
      deviceAt,
    };
    try {
      const online = await deviceIsOnline();
      await persistThenSendAttendance(item, online, sendTap);
      await load();
    } catch (err) {
      setError(attendanceError(err instanceof Error ? err.message : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>
        {shown === 'in' ? 'You are signed in' : 'You are signed out'}
      </Text>
      {since ? <Text style={{ color: theme.muted, fontSize: 16 }}>Signed in since {formatUkDateTime(since)}</Text> : null}
      {notices.map((notice) => (
        <SeenRejectNotice
          key={notice.id}
          message={notice.message}
          onDismiss={() => {
            void getAttendanceQueue()
              .dismissNotice(notice.id)
              .then(() => setNotices((current) => current.filter((item) => item.id !== notice.id)));
          }}
        />
      ))}
      {queued.length > 0 ? (
        <Text
          accessibilityRole="text"
          style={{
            color: theme.text,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.line,
            fontSize: 16,
            lineHeight: 22,
            padding: 12,
            borderRadius: 12,
            overflow: 'hidden',
          }}>
          {SAVED_ON_PHONE}
        </Text>
      ) : null}
      {error ? <Text style={{ color: theme.danger, fontSize: 16 }}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shown === 'in' ? 'Sign out' : 'Sign in'}
        disabled={busy}
        onPress={() => void onPress()}
        style={{
          minHeight: 56,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: shown === 'in' ? theme.open : theme.current,
          paddingHorizontal: 18,
          paddingVertical: 12,
        }}>
        <Text style={{ color: shown === 'in' ? theme.text : theme.currentInk, fontSize: 20, fontWeight: '800' }}>
          {busy ? 'Saving…' : shown === 'in' ? 'Sign out' : 'Sign in'}
        </Text>
      </Pressable>
    </View>
  );
}
