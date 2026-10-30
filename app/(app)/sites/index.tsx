import { AppTabs } from '@/components/app-tabs';
import { SignNudgeCard } from '@/components/sign-nudge';
import { CompanyLogo } from '@/components/CompanyLogo';
import { Icon } from '@/components/icon';
import { PhoneStatus } from '@/components/phone-status';
import { Button, Card, ChoiceChip, EmptyState, ErrorText, Field, FilterOnClear, GlanceRow, Muted, Screen, OutOfDateBadge, SeenRejectNotice } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { newDrawingsLine, type SiteSeenGap, type UnseenDrawing } from '@/data/drawingSeen';
import { countsForSite, freshLineParts, homeCardLines, type HomeCardLines, type HomeKindCounts } from '@/data/homeNewCounts';
import { repo } from '@/data/index';
import { loadSignNudge, signNudgeCopy, signNudgeTarget, signNudgeVisible, type UnsignedSignDocument } from '@/data/signNudge';
import { memberMustSign } from '@/data/siteDocuments';
import { canManageSite } from '@/data/repo';
import { badgeReadIsCurrent } from '@/data/siteListSeen';
import type { HomeSite, PulseRow } from '@/data/types';
import { workingRows } from '@/data/walk';
import { cacheAssignedSites, readCachedSites, readPackMeta } from '@/lib/offline';
import { packIsStale } from '@/lib/offlinePack';
import { syncAssignedPacks } from '@/lib/syncPacks';
import { confirmQueued, SAVED_ON_PHONE, type QueuedSeen, type SeenNotice } from '@/lib/drawingSeenQueue';
import { openReplacedNotice, refreshDrawingSeen } from '@/lib/drawingSeenSync';
import { formatWhen } from '@/lib/format';
import { loadHomeSiteNewCounts } from '@/lib/homeNewCounts';
import { allPendingSiteListSaves } from '@/lib/siteListSeenSync';
import { hit, space, textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

export default function SitesScreen() {
  const { person, acknowledgePasswordReset } = useAuth();
  const router = useRouter();
  const manager = person != null && canManageSite(person.role);
  const [rows, setRows] = useState<PulseRow[]>([]);
  const [mine, setMine] = useState<HomeSite[]>(readCachedSites());
  const [query, setQuery] = useState('');
  const [staleOnly, setStaleOnly] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [unseen, setUnseen] = useState<UnseenDrawing[]>([]);
  const [gaps, setGaps] = useState<SiteSeenGap[]>([]);
  const [queued, setQueued] = useState<QueuedSeen[]>([]);
  const [notices, setNotices] = useState<SeenNotice[]>([]);
  const [newCounts, setNewCounts] = useState<Record<string, HomeKindCounts> | null>(null);
  const [nudge, setNudge] = useState<UnsignedSignDocument[] | null>(null);
  const countToken = useRef(0);

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
      if (!person) return;
      let active = true;
      const token = ++countToken.current;
      // Drop the previous numbers before the read, including while a seen save is still in flight.
      setNewCounts(null);
      void (async () => {
        await Promise.all(allPendingSiteListSaves());
        if (!active || !badgeReadIsCurrent(token, countToken.current)) return;
        const next = await loadHomeSiteNewCounts();
        if (!active || !badgeReadIsCurrent(token, countToken.current)) return;
        setNewCounts(next);
      })();
      return () => {
        active = false;
      };
    }, [person])
  );

  useFocusEffect(
    useCallback(() => {
      if (!person) return;
      let active = true;
      if (!memberMustSign(person.role)) {
        setNudge([]);
        return () => {
          active = false;
        };
      }
      loadSignNudge(() => repo.listUnsignedSiteDocuments()).then((next) => {
        if (active) setNudge(next);
      });
      return () => {
        active = false;
      };
    }, [person]),
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

  function seenNotes(siteId: string) {
    const badges = unseen.filter(
      (row) => row.site_id === siteId && !confirmQueued(queued, row.drawing_id, row.revision)
    );
    const waiting = queued.some((item) => item.kind === 'confirm' && item.siteId === siteId);
    const gap = gaps.find((row) => row.site_id === siteId);
    const unseenDrawings = manager && gap ? gap.not_seen_by_everyone : 0;
    const rejections = notices.filter((notice) => notice.siteId === siteId);
    return { badges, waiting, unseenDrawings, rejections };
  }

  const working = useMemo(() => workingRows(rows), [rows]);
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
  const nudgeCopy = signNudgeVisible(nudge) ? signNudgeCopy(nudge ?? []) : null;

  function openNudge() {
    if (!nudge) return;
    const target = signNudgeTarget(nudge);
    if (!target) return;
    if (target.kind === 'list') {
      router.push('/to-sign');
      return;
    }
    router.push(`/sites/${target.siteId}/documents/${target.documentId}`);
  }

  const nudgeCard = nudgeCopy ? (
    <SignNudgeCard title={nudgeCopy.title} detail={nudgeCopy.detail} onPress={openNudge} />
  ) : null;

  function acknowledge() {
    void acknowledgePasswordReset().catch(() => setError('Could not clear that notice.'));
  }

  const resetNotice = person?.password_reset_at ? (
    <Card>
      <Text style={textStyle.title}>Your password was reset</Text>
      <Muted>If that wasn’t you, ask your manager for a new code.</Muted>
      <Button label="OK" onPress={acknowledge} />
    </Card>
  ) : null;

  if (!manager) {
    const assigned = workingRows(mine);
    return (
      <Screen footer={footer}>
        <SitesHeader memberSettings={person != null && person.role !== 'owner'} onSettings={() => router.push('/company')} />
        {nudgeCard}
        {resetNotice}
        <PhoneStatus />
        {error ? <ErrorText>{error}</ErrorText> : null}
        {loaded && !error && assigned.length === 0 ? (
          <EmptyState icon="apartment" title="You’re not on a site yet — ask your owner" />
        ) : (
          assigned.map((site) => (
            <View key={site.id} style={{ gap: space.md }}>
              <SiteCard
                name={site.name}
                address={site.address_line}
                updated={formatWhen(site.updated_at)}
                stale={packIsStale(readPackMeta(site.id), { updatedAt: site.updated_at })}
                lines={homeCardLines(site.my_open_request_count ?? 0, 0, countsForSite(newCounts, site.id))}
                onPress={() => router.push(`/sites/${site.id}`)}
              />
              <SeenNotes
                manager={false}
                notes={seenNotes(site.id)}
                onNew={() => router.push(`/sites/${site.id}/new`)}
                onNotice={(notice) => void followNotice(router, notice)}
              />
            </View>
          ))
        )}
      </Screen>
    );
  }

  const showCreate = person.role === 'owner' && working.length > 0;
  return (
    <Screen footer={footer}>
      <SitesHeader memberSettings={person.role !== 'owner'} onSettings={() => router.push('/company')} />
      {nudgeCard}
      {resetNotice}
      <PhoneStatus />
      {showCreate ? <Button label="Create site" onPress={() => router.push('/create-site')} /> : null}
      <Field label="Search sites" value={query} onChangeText={setQuery} placeholder="Oak, Riverside…" autoCapitalize="words" />
      <View style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.md }}>
          <ChoiceChip label="Has open requests" selected={openOnly} onPress={() => setOpenOnly((value) => !value)} />
          <ChoiceChip label="Not updated in 7 days" selected={staleOnly} onPress={() => setStaleOnly((value) => !value)} />
        </View>
        {openOnly || staleOnly ? (
          <FilterOnClear
            shown={filtered.length}
            total={working.length}
            noun="sites"
            onClear={() => {
              setOpenOnly(false);
              setStaleOnly(false);
            }}
          />
        ) : null}
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {loaded && !error && filtered.length === 0 ? (
        <EmptyState
          icon="apartment"
          title={working.length === 0 ? 'No sites yet' : 'No sites match those filters'}
          action={
            working.length === 0 && person.role === 'owner' ? (
              <Button label="Create site" onPress={() => router.push('/create-site')} />
            ) : undefined
          }
        />
      ) : (
        filtered.map((row) => (
          <View key={row.site_id} style={{ gap: space.md }}>
            <SiteCard
              name={row.name}
              address={row.address_line}
              updated={formatWhen(row.last_pack_update)}
              stale={packIsStale(readPackMeta(row.site_id), { updatedAt: row.last_pack_update })}
              lines={homeCardLines(
                row.open_request_count,
                seenNotes(row.site_id).unseenDrawings,
                countsForSite(newCounts, row.site_id),
              )}
              onPress={() => router.push(`/sites/${row.site_id}`)}
            />
            <SeenNotes
              manager
              notes={seenNotes(row.site_id)}
              onNew={() => router.push(`/sites/${row.site_id}/new`)}
              onNotice={(notice) => void followNotice(router, notice)}
            />
          </View>
        ))
      )}
    </Screen>
  );
}

function FreshLine({ line }: { line: string }) {
  const parts = freshLineParts(line);
  const pieces: { key: string; text: string; hold: boolean }[] = [];
  parts.forEach((part, index) => {
    if (index > 0) pieces.push({ key: `dot-${index}`, text: ' · ', hold: false });
    pieces.push({ key: `part-${index}`, text: part, hold: true });
  });
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {pieces.map((piece) => (
        <Text
          key={piece.key}
          textBreakStrategy="simple"
          style={[
            textStyle.bodyStrong,
            textStyle.tabular,
            piece.hold ? { flexShrink: 0 } : null,
            piece.hold && Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as object) : null,
          ]}>
          {piece.text}
        </Text>
      ))}
    </View>
  );
}

function SitesHeader({ memberSettings, onSettings }: { memberSettings?: boolean; onSettings?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <CompanyLogo />
      {memberSettings && onSettings ? <PressableSettings onPress={onSettings} /> : null}
    </View>
  );
}

function PressableSettings({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Company settings"
      onPress={onPress}
      style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="settings" color={theme.text} />
    </Pressable>
  );
}

function SiteCard({
  name,
  address,
  updated,
  stale,
  lines,
  onPress,
}: {
  name: string;
  address: string | null | undefined;
  updated: string;
  stale: boolean;
  lines: HomeCardLines;
  onPress: () => void;
}) {
  const place = address?.trim() ?? '';
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: hit.min }}>
        <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
          <Text style={textStyle.bodyStrong}>{name}</Text>
          {place ? <Text style={textStyle.meta}>{place}</Text> : null}
          {updated ? (
            <Text testID="site-updated" textBreakStrategy="simple" style={textStyle.meta}>
              {updated}
            </Text>
          ) : null}
          {lines.status ? (
            <Text style={textStyle.metaStrong} numberOfLines={2}>
              {lines.status}
            </Text>
          ) : null}
        </View>
        {stale ? <OutOfDateBadge /> : null}
        <Icon name="chevron_right" color={theme.muted} />
      </View>
      {lines.fresh ? <FreshLine line={lines.fresh} /> : null}
    </Card>
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
  onNew,
  onNotice,
}: {
  manager: boolean;
  notes: { badges: UnseenDrawing[]; waiting: boolean; unseenDrawings: number; rejections: SeenNotice[] };
  onNew: () => void;
  onNotice: (notice: SeenNotice) => void;
}) {
  const fresh = manager ? null : newDrawingsLine(notes.badges.length);
  if (!fresh && !notes.waiting && notes.rejections.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      {notes.rejections.map((notice) => (
        <SeenRejectNotice key={notice.id} message={notice.message} onPress={() => onNotice(notice)} />
      ))}
      {fresh ? <GlanceRow label={fresh} onPress={onNew} /> : null}
      {notes.waiting ? (
        <Text style={textStyle.bodyStrong}>{SAVED_ON_PHONE}</Text>
      ) : null}
    </View>
  );
}
