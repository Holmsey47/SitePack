import { SeenRejectNotice } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import type { MySiteAttendance } from '@/data/attendance';
import { attemptSiteSwitch, attendanceError, SWITCH_NEEDS_SIGNAL } from '@/data/attendance';
import { clientNowIso, forgotYesterday, LATE_SIGN_OUT_NOTICE, LATE_SIGN_OUT_REASON } from '@/lib/attendanceHours';
import { formatUkDateTime } from '@/lib/format';
import {
  flushAttendanceQueue,
  forgotSeenIds,
  getAttendanceQueue,
  lateSignOutNotice,
  markForgotSeen,
  noticesForUser,
  pendingTapsForUser,
  persistThenSendAttendance,
  SAVED_ON_PHONE,
  SIGN_IN_AGAIN,
  stateAfterQueue,
  type AttendanceNotice,
  type QueuedTap,
} from '@/lib/attendanceQueue';
import { deviceIsOnline } from '@/lib/variationQueue';
import { theme } from '@/lib/theme';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

async function sendTap(item: QueuedTap) {
  if (item.action === 'in') {
    await repo.signInSite(item.siteId, item.deviceAt);
    return;
  }
  const entry = await repo.signOutSite(item.siteId, item.deviceAt);
  if (entry.late_sign_out) {
    await getAttendanceQueue().putNotice(lateSignOutNotice(item, LATE_SIGN_OUT_NOTICE));
  }
}

export function SiteSignButton({ siteId }: { siteId: string }) {
  const { person } = useAuth();
  const router = useRouter();
  const userId = person?.auth_user_id ?? '';
  const ownerId = person?.id ?? '';
  const [server, setServer] = useState<MySiteAttendance | null>(null);
  const [queued, setQueued] = useState<QueuedTap[]>([]);
  const [notices, setNotices] = useState<AttendanceNotice[]>([]);
  const [yesterday, setYesterday] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const live = useRef(true);

  const load = useCallback(async () => {
    if (!siteId || !userId) return;
    const queue = getAttendanceQueue();
    const connected = await deviceIsOnline();
    if (live.current) setOnline(connected);
    if (connected) {
      await flushAttendanceQueue(queue, userId, sendTap).catch(() => undefined);
    }
    const pending = pendingTapsForUser(await queue.list(), userId, siteId);
    const notes = noticesForUser(await queue.listNotices(), userId, siteId);
    setQueued(pending);
    setNotices(notes);
    try {
      const mine = await repo.listMyAttendance(siteId);
      const found = forgotYesterday(
        mine.map((entry) => ({
          entryId: entry.entry_id,
          personId: entry.person_id,
          inAt: entry.in_at,
          forgot: entry.forgot_sign_out,
          corrected: (entry.audit ?? []).some((row) => row.reason !== LATE_SIGN_OUT_REASON),
        })),
        clientNowIso(),
        ownerId,
        forgotSeenIds(userId)
      );
      if (found && live.current) {
        markForgotSeen(userId, found.entryId);
        setYesterday(found.message);
      }
    } catch {
      // The sign-in button still works if yesterday's list cannot be read.
    }
    try {
      setServer(await repo.mySiteAttendance(siteId));
      setError('');
    } catch (err) {
      setError(attendanceError(err));
    }
  }, [ownerId, siteId, userId]);

  useFocusEffect(
    useCallback(() => {
      live.current = true;
      load().catch(() => setError('Could not load sign-in.'));
      return () => {
        live.current = false;
        setYesterday(null);
      };
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
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  async function switchSite(notice: AttendanceNotice) {
    if (busy || !notice.openSiteId || !notice.openSiteName) return;
    setBusy(true);
    setError('');
    const deviceAt = clientNowIso();
    let signOutError: unknown = null;
    try {
      const connected = await deviceIsOnline();
      if (live.current) setOnline(connected);
      const result = await attemptSiteSwitch(
        connected,
        notice.openSiteId,
        notice.openSiteName,
        siteId,
        deviceAt,
        (id, at) => repo.signOutSite(id, at),
        (id, at) => repo.signInSite(id, at)
      );
      if (result.kind === 'done') {
        await getAttendanceQueue().dismissNotice(notice.id);
      } else if (result.kind === 'signed_out') {
        await getAttendanceQueue().dismissNotice(notice.id);
        await getAttendanceQueue().putNotice({
          id: `switch:${notice.openSiteId}:${deviceAt}`,
          userId,
          siteId,
          message: result.notice,
        });
      } else if (result.kind === 'sign_out_failed') {
        signOutError = result.error;
      }
    } finally {
      setBusy(false);
      await load().catch(() => undefined);
      if (signOutError) setError(attendanceError(signOutError));
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>
        {shown === 'in' ? 'You are signed in' : 'You are signed out'}
      </Text>
      {since ? <Text style={{ color: theme.muted, fontSize: 16 }}>Signed in since {formatUkDateTime(since)}</Text> : null}
      {yesterday ? (
        <Text accessibilityRole="text" style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>
          {yesterday}
        </Text>
      ) : null}
      {notices.map((notice) => (
        <View key={notice.id} style={{ gap: 8 }}>
          <SeenRejectNotice
            message={notice.message}
            onDismiss={() => {
              void getAttendanceQueue()
                .dismissNotice(notice.id)
                .then(() => setNotices((current) => current.filter((item) => item.id !== notice.id)));
            }}
          />
          {notice.openSiteId && notice.openSiteName ? (
            <View style={{ gap: 4 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Sign out of ${notice.openSiteName} and sign in here`}
                accessibilityState={{ disabled: busy || !online }}
                disabled={busy || !online}
                onPress={() => void switchSite(notice)}
                style={{
                  minHeight: 48,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.current,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  opacity: online ? 1 : 0.45,
                }}>
                <Text style={{ color: theme.current, fontSize: 16, fontWeight: '800', textAlign: 'center' }}>
                  {`Sign out of ${notice.openSiteName} and sign in here`}
                </Text>
              </Pressable>
              {online ? null : (
                <Text accessibilityRole="text" style={{ color: theme.muted, fontSize: 16 }}>
                  {SWITCH_NEEDS_SIGNAL}
                </Text>
              )}
            </View>
          ) : null}
        </View>
      ))}
      {queued.some((item) => item.needsSignIn) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={SIGN_IN_AGAIN}
          onPress={() => router.push('/login')}
          style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: theme.current, fontSize: 16, fontWeight: '800' }}>{SIGN_IN_AGAIN}</Text>
        </Pressable>
      ) : null}
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
