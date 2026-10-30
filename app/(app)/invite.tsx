import { Icon } from '@/components/icon';
import { JoinCodeOffer } from '@/components/JoinCodeOffer';
import { Button, EmptyState, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { inviteFailureMessage } from '@/data/inviteError';
import { inviteSiteChoice, inviteSitesFromPulse } from '@/data/inviteEntry';
import { canManageSite } from '@/data/repo';
import { sitesAfterReload } from '@/data/siteList';
import type { PulseRow, Role } from '@/data/types';
import { roleLabel } from '@/data/walk';
import { hit, radius, space, textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

const ROLES: Role[] = ['operative', 'cm', 'owner'];

export default function InviteScreen() {
  const { person } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const emailFlag = Array.isArray(params.email) ? params.email[0] : params.email;
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('operative');
  const [trade, setTrade] = useState('');
  const [sites, setSites] = useState<PulseRow[]>([]);
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [listNotice, setListNotice] = useState('');
  const [emailDone, setEmailDone] = useState(false);
  const [emailOpen, setEmailOpen] = useState(emailFlag === '1');
  const [emailLoading, setEmailLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!person || person.role === 'operative') return;
      let active = true;
      repo
        .companySitesPulse()
        .then((rows) => {
          if (!active) return;
          const next = sitesAfterReload(rows, []);
          setSites(next.sites);
          setListNotice(next.notice);
          setLoaded(true);
        })
        .catch(() => {
          if (!active) return;
          setSites((current) => sitesAfterReload(null, current).sites);
          setListNotice(sitesAfterReload(null, []).notice);
          setLoaded(true);
        });
      return () => {
        active = false;
      };
    }, [person]),
  );

  const openChoice = useMemo(() => inviteSiteChoice(inviteSitesFromPulse(sites)), [sites]);

  useEffect(() => {
    if (openChoice.kind === 'one') {
      setSelectedId(openChoice.site.id);
      return;
    }
    if (openChoice.kind === 'none') {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) => (current && openChoice.sites.some((site) => site.id === current) ? current : null));
  }, [openChoice]);

  useEffect(() => {
    if (emailFlag === '1') setEmailOpen(true);
  }, [emailFlag]);

  if (person && !canManageSite(person.role)) return <Redirect href="/sites" />;

  const allowedRoles = person?.role === 'cm' ? (['operative'] as Role[]) : ROLES;
  const openSites = openChoice.kind === 'many' ? openChoice.sites : openChoice.kind === 'one' ? [openChoice.site] : [];

  function toggleSite(siteId: string) {
    setSiteIds((current) => (current.includes(siteId) ? current.filter((id) => id !== siteId) : [...current, siteId]));
  }

  async function onSubmit() {
    setEmailLoading(true);
    setError('');
    try {
      await repo.invitePerson({
        email,
        displayName,
        role,
        trade: trade.trim() || null,
        siteIds,
      });
      setEmailDone(true);
    } catch (err) {
      setError(inviteFailureMessage(err instanceof Error ? err.message : null, 'The invite did not send. Try again.'));
    } finally {
      setEmailLoading(false);
    }
  }

  return (
    <Screen>
      <Muted>A valid code puts them straight on the site. No approval step.</Muted>
      {listNotice ? <Text style={{ color: theme.muted }}>{listNotice}</Text> : null}
      {!loaded ? <Muted>Loading sites…</Muted> : null}
      {loaded && !listNotice && openChoice.kind === 'none' ? (
        <EmptyState
          title="Make a site first"
          action={
            person?.role === 'owner' ? (
              <Button label="Create site" minHeight={56} onPress={() => router.push('/create-site')} />
            ) : (
              <Muted>Ask the owner to make a site.</Muted>
            )
          }
        />
      ) : null}
      {loaded && openChoice.kind !== 'none' ? (
        <View style={{ gap: 8 }}>
          <Text style={textStyle.metaStrong}>
            {openChoice.kind === 'one' ? 'Site' : 'Which site?'}
          </Text>
          {openSites.map((site) => {
            const selected = selectedId === site.id;
            return (
              <Pressable
                key={site.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setSelectedId(site.id)}
                style={{
                  minHeight: hit.secondary,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingHorizontal: 14,
                  borderRadius: radius.control,
                  borderWidth: 2,
                  borderColor: selected ? theme.text : theme.line,
                  backgroundColor: selected ? theme.surfaceAlt : theme.surface,
                }}>
                <Text style={[textStyle.bodyStrong, { flex: 1 }]}>{site.name}</Text>
                {selected ? <Icon name="check" color={theme.text} /> : null}
              </Pressable>
            );
          })}
          {selectedId ? (
            <JoinCodeOffer
              key={selectedId}
              siteId={selectedId}
              siteName={openSites.find((site) => site.id === selectedId)?.name ?? 'this site'}
            />
          ) : null}
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button
        label={emailOpen ? 'Hide email invite' : 'Invite by email instead'}
        variant="secondary"
        minHeight={48}
        onPress={() => setEmailOpen((current) => !current)}
      />
      {emailOpen ? (
        emailDone ? (
          <Title>
            Invite sent to {displayName.trim()}, {email.trim()}.
          </Title>
        ) : (
          <View style={{ gap: 16 }}>
            <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
            <Field label="Name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
            <Field label="Occupation" value={trade} onChangeText={setTrade} placeholder="Optional" />
            <Text style={textStyle.metaStrong}>Role</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {allowedRoles.map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setRole(value)}
                  style={{
                    minHeight: 48,
                    justifyContent: 'center',
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                    backgroundColor: role === value ? theme.text : theme.surface,
                  }}>
                  <Text style={{ ...textStyle.bodyStrong, color: role === value ? theme.bg : theme.text }}>
                    {roleLabel(value)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={textStyle.metaStrong}>Sites</Text>
            {openSites.map((site) => {
              const on = siteIds.includes(site.id);
              return (
                <Pressable
                  key={site.id}
                  onPress={() => toggleSite(site.id)}
                  style={{
                    minHeight: 48,
                    justifyContent: 'center',
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: on ? theme.text : theme.line,
                  }}>
                  <Text style={{ color: theme.text }}>{site.name}</Text>
                </Pressable>
              );
            })}
            <Button
              label="Send invite"
              onPress={() => void onSubmit()}
              loading={emailLoading}
              disabled={!email.trim() || !displayName.trim()}
            />
          </View>
        )
      ) : null}
    </Screen>
  );
}
