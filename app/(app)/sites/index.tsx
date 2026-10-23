import { AppTabs } from '@/components/app-tabs';
import { FixtureOfflineSwitch } from '@/components/fixture-offline';
import { TalkNoticeList, TalkQuestionRow, TalkReadRow } from '@/components/TalkRows';
import { Button, Card, EmptyState, ErrorText, Field, GlanceRow, HeaderActions, Muted, Screen, OutOfDateBadge, SeenRejectNotice, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { newDrawingsLine, siteUnseenLine, type SiteSeenGap, type UnseenDrawing } from '@/data/drawingSeen';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { TalkBadge } from '@/data/talks';
import { pendingShareRequestLabel, rememberSharedSiteIds, shareRenameNote, sharedSectionLine, type ShareNotice, type SharedSiteCard } from '@/data/sharing';
import type { HomeSite, PulseRow } from '@/data/types';
import { archivedRows, contractsManagerLine, operativesLine, workingRows } from '@/data/walk';
import { forgetSharedSite } from '@/lib/forgetShare';
import { cacheAssignedSites, readCachedSites, readPackMeta } from '@/lib/offline';
import { packIsStale } from '@/lib/offlinePack';
import { syncAssignedPacks } from '@/lib/syncPacks';
import { confirmQueued, SAVED_ON_PHONE, type QueuedSeen, type SeenNotice } from '@/lib/drawingSeenQueue';
import { openReplacedNotice, refreshDrawingSeen } from '@/lib/drawingSeenSync';
import { dismissTalkNotice, getTalkQueue, retryQueuedTalk, type TalkNotice } from '@/lib/talkQueue';
import { refreshTalks } from '@/lib/talkSync';
import { formatUkDateTime, formatWhen } from '@/lib/format';
import { theme } from '@/lib/theme';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function SitesScreen() {
  const { person, signOut, acknowledgePasswordReset } = useAuth();
  const router = useRouter();
  const manager = person != null && canManageSite(person.role);
  const [rows, setRows] = useState<PulseRow[]>([]);
  const [mine, setMine] = useState<HomeSite[]>(readCachedSites());
  const [query, setQuery] = useState('');
  const [staleOnly, setStaleOnly] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [unseen, setUnseen] = useState<UnseenDrawing[]>([]);
  const [gaps, setGaps] = useState<SiteSeenGap[]>([]);
  const [queued, setQueued] = useState<QueuedSeen[]>([]);
  const [notices, setNotices] = useState<SeenNotice[]>([]);
  const [talkBadges, setTalkBadges] = useState<TalkBadge[]>([]);
  const [sharedSites, setSharedSites] = useState<SharedSiteCard[]>([]);
  const [shareNotices, setShareNotices] = useState<ShareNotice[]>([]);
  const [talkNotices, setTalkNotices] = useState<TalkNotice[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!person) return;
      let active = true;
      repo
        .mySharedSites()
        .then(async (next) => {
          if (!active) return;
          const storage = readStorage();
          if (storage) {
            const dropped = rememberSharedSiteIds(
              storage,
              next.map((row) => row.site_id)
            );
            for (const id of dropped) await forgetSharedSite(id);
          }
          if (!active) return;
          setSharedSites(next);
        })
        .catch(() => {
          if (active) setSharedSites([]);
        });
      return () => {
        active = false;
      };
    }, [person])
  );

  useFocusEffect(
    useCallback(() => {
      if (!person) return;
      let active = true;
      if (person.role === 'operative') {
        repo
          .listAssignedSites()
          .then((next) => {
            if (!active) return;
            setMine(next);
            cacheAssignedSites(next);
            setLoaded(true);
            setError('');
          })
          .catch(() => {
            if (!active) return;
            setError('Could not load sites.');
          });
        return () => {
          active = false;
        };
      }
      repo
        .companySitesPulse()
        .then((next) => {
          if (!active) return;
          setRows(next);
          setLoaded(true);
          setError('');
        })
        .catch(() => {
          if (!active) return;
          setError('Could not load sites.');
        });
      return () => {
        active = false;
      };
    }, [person])
  );

  useFocusEffect(
    useCallback(() => {
      if (!person || !manager) {
        setShareNotices([]);
        return;
      }
      let active = true;
      repo
        .myShareNotices()
        .then((next) => {
          if (active) setShareNotices(next);
        })
        .catch(() => {
          if (active) setShareNotices([]);
        });
      return () => {
        active = false;
      };
    }, [manager, person])
  );

  useFocusEffect(
    useCallback(() => {
      if (!person) return;
      let active = true;
      refreshDrawingSeen(manager, person.auth_user_id)
        .then((next) => {
          if (!active) return;
          setUnseen(next.unseen);
          setGaps(next.gaps);
          setQueued(next.queued);
          setNotices(next.notices);
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [manager, person])
  );

  useFocusEffect(
    useCallback(() => {
      if (!person?.auth_user_id) return;
      let active = true;
      refreshTalks(person.auth_user_id)
        .then((next) => {
          if (!active) return;
          setTalkBadges(next.badges);
          setTalkNotices(next.notices);
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [person?.auth_user_id])
  );

  async function dismissTalk(notice: TalkNotice) {
    await dismissTalkNotice(getTalkQueue(), notice);
    setTalkNotices((current) => current.filter((row) => row.id !== notice.id));
  }

  async function retryTalk(notice: TalkNotice) {
    if (!notice.retryLocalId || !person?.auth_user_id) return;
    await retryQueuedTalk(getTalkQueue(), notice.retryLocalId);
    const next = await refreshTalks(person.auth_user_id);
    setTalkBadges(next.badges);
    setTalkNotices(next.notices);
  }

  function talkNotes(siteId: string) {
    const badge = talkBadges.find((row) => row.site_id === siteId);
    const siteNotices = talkNotices.filter((row) => row.siteId === siteId);
    if (!badge && siteNotices.length === 0) return null;
    return (
      <View>
        <TalkNoticeList notices={siteNotices} onDismiss={(notice) => void dismissTalk(notice)} onRetry={(notice) => void retryTalk(notice)} />
        <TalkReadRow count={badge?.outstanding ?? 0} onPress={() => router.push(`/sites/${siteId}/talks`)} />
        <TalkQuestionRow count={badge?.questions ?? 0} onPress={() => router.push(`/sites/${siteId}/talks`)} />
      </View>
    );
  }

  function seenNotes(siteId: string) {
    const badges = unseen.filter(
      (row) => row.site_id === siteId && !confirmQueued(queued, row.drawing_id, row.revision)
    );
    const waiting = queued.some((item) => item.kind === 'confirm' && item.siteId === siteId);
    const gap = gaps.find((row) => row.site_id === siteId);
    const line = manager && gap ? siteUnseenLine(gap.not_seen_by_everyone) : null;
    const rejections = notices.filter((notice) => notice.siteId === siteId);
    return { badges, waiting, line, rejections };
  }

  const working = useMemo(() => workingRows(rows), [rows]);
  const archived = useMemo(() => archivedRows(rows), [rows]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return working.filter((row) => {
      if (q && !row.name.toLowerCase().includes(q)) return false;
      if (openOnly && row.open_request_count < 1) return false;
      if (staleOnly) {
        if (!row.last_pack_update) return true;
        const age = Date.now() - new Date(row.last_pack_update).getTime();
        return age > 7 * 24 * 60 * 60 * 1000;
      }
      return true;
    });
  }, [working, query, staleOnly, openOnly]);

  useEffect(() => {
    if (!person) return;
    let active = true;
    void syncAssignedPacks(() => active).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [person]);

  const footer = person ? <AppTabs role={person.role} /> : null;

  function acknowledge() {
    void acknowledgePasswordReset().catch(() => setError('Could not clear that notice.'));
  }

  const resetNotice = person?.password_reset_at ? (
    <Card>
      <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>Your password was reset</Text>
      <Muted>If that wasn’t you, ask your manager for a new code.</Muted>
      <Button label="OK" onPress={acknowledge} />
    </Card>
  ) : null;

  if (!manager) {
    return (
      <Screen footer={footer}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Title>Sites</Title>
          <HeaderActions label="Sign out" onPress={() => void signOut()} />
        </View>
        {resetNotice}
        <FixtureOfflineSwitch />
        <SharedWithCompany rows={sharedSites} onOpen={(id) => router.push(`/sites/${id}/shared`)} />
        {error ? <ErrorText>{error}</ErrorText> : null}
        {loaded && !error && workingRows(mine).length === 0 && archivedRows(mine).length === 0 ? (
          <EmptyState title="You’re not on a site yet — ask your owner" />
        ) : (
          workingRows(mine).map((site) => (
            <Card key={site.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={site.name}
                onPress={() => router.push(`/sites/${site.id}`)}
                style={{ minHeight: 48, justifyContent: 'center', gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700', flex: 1 }}>{site.name}</Text>
                  {packIsStale(readPackMeta(site.id), { updatedAt: site.updated_at }) ? <OutOfDateBadge /> : null}
                </View>
                {site.address_line ? <Muted>{site.address_line}</Muted> : null}
                <Muted>{formatWhen(site.updated_at)}</Muted>
                {(site.my_open_request_count ?? 0) > 0 ? (
                  <Text style={{ color: theme.open, fontWeight: '700' }}>
                    {site.my_open_request_count} open request{site.my_open_request_count === 1 ? '' : 's'} you raised
                  </Text>
                ) : null}
              </Pressable>
              <SeenNotes
                manager={false}
                notes={seenNotes(site.id)}
                onTeam={() => router.push(`/sites/${site.id}/not-seen`)}
                onNew={() => router.push(`/sites/${site.id}/new`)}
                onNotice={(notice) => void followNotice(router, notice)}
              />
              {talkNotes(site.id)}
            </Card>
          ))
        )}
        {archivedRows(mine).length > 0 ? (
          <Pressable onPress={() => setShowArchived((value) => !value)} style={{ paddingVertical: 8 }}>
            <Text style={{ color: theme.text, fontWeight: '800' }}>{showArchived ? 'Hide archived' : 'Archived'}</Text>
          </Pressable>
        ) : null}
        {showArchived
          ? archivedRows(mine).map((site) => (
              <Card key={site.id} onPress={() => router.push(`/sites/${site.id}`)}>
                <Text style={{ color: theme.archive, fontSize: 18, fontWeight: '700' }}>{site.name}</Text>
                {site.address_line ? <Muted>{site.address_line}</Muted> : null}
              </Card>
            ))
          : null}
      </Screen>
    );
  }

  return (
    <Screen footer={footer}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Title>Sites</Title>
        <HeaderActions label="Sign out" onPress={() => void signOut()} />
      </View>
      {resetNotice}
      <FixtureOfflineSwitch />
      <SharedWithCompany rows={sharedSites} onOpen={(id) => router.push(`/sites/${id}/shared`)} />
      {shareNotices.map((row) => (
        <Card key={row.share_id}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{pendingShareRequestLabel(row)}</Text>
          <Muted>{sharedSectionLine(row.sections)}</Muted>
          {row.code_expires_at ? <Muted>{`Expires ${formatUkDateTime(row.code_expires_at)}`}</Muted> : null}
          {shareRenameNote(row) ? <Muted>{shareRenameNote(row)}</Muted> : null}
          <Button
            label="Review"
            minHeight={56}
            onPress={() => router.push(`/sites/${row.site_id}/share`)}
          />
        </Card>
      ))}
      {person.role === 'owner' ? <Button label="Create site" onPress={() => router.push('/create-site')} /> : null}
      <Field label="Search sites" value={query} onChangeText={setQuery} placeholder="Oak, Riverside…" autoCapitalize="words" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => setOpenOnly((value) => !value)} style={{ paddingVertical: 8 }}>
          <Text style={{ color: openOnly ? theme.current : theme.muted, fontWeight: '700' }}>Has open requests</Text>
        </Pressable>
        <Pressable onPress={() => setStaleOnly((value) => !value)} style={{ paddingVertical: 8 }}>
          <Text style={{ color: staleOnly ? theme.current : theme.muted, fontWeight: '700' }}>Not updated in 7 days</Text>
        </Pressable>
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loaded && !error && filtered.length === 0 && (working.length > 0 || archived.length === 0) ? (
        <EmptyState title={working.length === 0 ? 'No sites yet' : 'No sites match those filters'} />
      ) : (
        filtered.map((row) => (
          <Card key={row.site_id}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={row.name}
              onPress={() => router.push(`/sites/${row.site_id}`)}
              style={{ minHeight: 48, justifyContent: 'center', gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700', flex: 1 }}>{row.name}</Text>
                {packIsStale(readPackMeta(row.site_id), { updatedAt: row.last_pack_update }) ? <OutOfDateBadge /> : null}
                {(row.new_joiner_count ?? 0) > 0 ? (
                  <Text
                    style={{
                      color: theme.currentInk,
                      backgroundColor: theme.current,
                      fontWeight: '800',
                      overflow: 'hidden',
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                    }}>
                    {(row.new_joiner_count ?? 0) === 1 ? 'New joiner' : `${row.new_joiner_count} new`}
                  </Text>
                ) : null}
              </View>
              {row.address_line ? <Muted>{row.address_line}</Muted> : null}
              <Muted>{contractsManagerLine(row.contracts_manager_names)}</Muted>
              <Muted>{operativesLine(row.operative_count)}</Muted>
              <Muted>{formatWhen(row.last_pack_update)}</Muted>
              <Text style={{ color: row.open_request_count ? theme.open : theme.muted, fontWeight: '700' }}>
                {row.open_request_count} open request{row.open_request_count === 1 ? '' : 's'}
              </Text>
            </Pressable>
            <SeenNotes
              manager
              notes={seenNotes(row.site_id)}
              onTeam={() => router.push(`/sites/${row.site_id}/not-seen`)}
              onNew={() => router.push(`/sites/${row.site_id}/new`)}
              onNotice={(notice) => void followNotice(router, notice)}
            />
            {talkNotes(row.site_id)}
          </Card>
        ))
      )}
      {archived.length > 0 ? (
        <Pressable onPress={() => setShowArchived((value) => !value)} style={{ paddingVertical: 8 }}>
          <Text style={{ color: theme.text, fontWeight: '800' }}>{showArchived ? 'Hide archived' : 'Archived'}</Text>
        </Pressable>
      ) : null}
      {showArchived
        ? archived.map((row) => (
            <Card key={row.site_id} onPress={() => router.push(`/sites/${row.site_id}`)}>
              <Text style={{ color: theme.archive, fontSize: 18, fontWeight: '700' }}>{row.name}</Text>
              <Muted>{contractsManagerLine(row.contracts_manager_names)}</Muted>
              <Muted>{operativesLine(row.operative_count)}</Muted>
            </Card>
          ))
        : null}
    </Screen>
  );
}

function readStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function SharedWithCompany({ rows, onOpen }: { rows: SharedSiteCard[]; onOpen: (siteId: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>SHARED WITH YOUR COMPANY</Text>
      {rows.map((row) => (
        <Card key={row.share_id} onPress={() => onOpen(row.site_id)}>
          <View style={{ minHeight: 48, justifyContent: 'center', gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700', flex: 1 }}>{row.site_name}</Text>
              <Text
                style={{
                  color: theme.currentInk,
                  backgroundColor: theme.current,
                  fontWeight: '800',
                  overflow: 'hidden',
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                }}>
                Shared
              </Text>
            </View>
            <Muted>{row.host_company_name}</Muted>
            <Muted>Their contracts manager: {row.cm_contact_name || 'the host company'}</Muted>
          </View>
        </Card>
      ))}
    </View>
  );
}

function followNotice(router: { push(path: `/sites/${string}/drawing/${string}`): void }, notice: SeenNotice) {
  void openReplacedNotice(notice).then((path) => {
    if (path) router.push(path);
  });
}

function SeenNotes({
  manager,
  notes,
  onTeam,
  onNew,
  onNotice,
}: {
  manager: boolean;
  notes: { badges: UnseenDrawing[]; waiting: boolean; line: string | null; rejections: SeenNotice[] };
  onTeam: () => void;
  onNew: () => void;
  onNotice: (notice: SeenNotice) => void;
}) {
  const fresh = manager ? null : newDrawingsLine(notes.badges.length);
  if (!fresh && !notes.waiting && !notes.line && notes.rejections.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      {notes.line ? <GlanceRow label={notes.line} onPress={onTeam} /> : null}
      {notes.rejections.map((notice) => (
        <SeenRejectNotice key={notice.id} message={notice.message} onPress={() => onNotice(notice)} />
      ))}
      {fresh ? <GlanceRow label={fresh} onPress={onNew} /> : null}
      {notes.waiting ? (
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{SAVED_ON_PHONE}</Text>
      ) : null}
    </View>
  );
}
