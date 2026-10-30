import { AppTabs } from '@/components/app-tabs';
import { Button, Card, EmptyState, ErrorText, Field, Muted, OverflowMenu, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import {
  canAddNoLogin,
  canAttachLogin,
  canOfferSiteManagerChange,
  pinnedOwnerFirst,
  occupationLine,
  peopleFailureMessage,
  peopleLoadFailureMessage,
  removableSites,
  siteManagerChange,
} from '@/data/companyPeople';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { CompanyPerson, PulseRow } from '@/data/types';
import { space, textStyle, theme } from '@/lib/theme';
import { personLabel, siteLabel } from '@/data/walk';
import { Text } from '@/src/theme/text';
import { Link, Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

export default function PeopleScreen() {
  const { person } = useAuth();
  const router = useRouter();
  const [people, setPeople] = useState<CompanyPerson[]>([]);
  const [sites, setSites] = useState<PulseRow[]>([]);
  const [name, setName] = useState('');
  const [trade, setTrade] = useState('');
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [inviteFor, setInviteFor] = useState<string | null>(null);
  const [removeFor, setRemoveFor] = useState<{ personId: string; siteId: string } | null>(null);
  const [roleFor, setRoleFor] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [nextPeople, nextSites] = await Promise.all([repo.companyPeople(), repo.companySitesPulse()]);
    setPeople(nextPeople);
    setSites(nextSites);
    setLoaded(true);
    setError('');
  }, []);

  async function refreshAfterWrite() {
    try {
      await load();
    } catch (err) {
      setError(peopleLoadFailureMessage(err));
    }
  }

  useFocusEffect(
    useCallback(() => {
      if (!person || person.role === 'operative') return;
      load().catch((err: unknown) => {
        setError(peopleLoadFailureMessage(err));
      });
    }, [load, person])
  );

  if (person?.role === 'operative') return <Redirect href="/sites" />;

  if (!loaded && !error) {
    return (
      <Screen>
        <Title>People</Title>
        <Muted>Loading people…</Muted>
      </Screen>
    );
  }

  const callerRole = person?.role ?? 'operative';

  function toggleSite(siteId: string) {
    setSiteIds((current) => (current.includes(siteId) ? current.filter((id) => id !== siteId) : [...current, siteId]));
  }

  async function onAdd() {
    setLoading(true);
    setError('');
    try {
      await repo.addNoLoginOperative({
        displayName: name,
        trade: trade.trim() || null,
        siteIds,
      });
      setName('');
      setTrade('');
      setSiteIds([]);
    } catch (err) {
      setError(peopleFailureMessage(err instanceof Error ? err.message : 'Could not add that name'));
      return;
    } finally {
      setLoading(false);
    }
    await refreshAfterWrite();
  }

  async function onRemove(personId: string, siteId: string) {
    setError('');
    try {
      await repo.removeOperativeFromSite(personId, siteId);
    } catch (err) {
      setError(peopleFailureMessage(err instanceof Error ? err.message : 'Could not remove them from that site'));
      return;
    }
    setRemoveFor(null);
    await refreshAfterWrite();
  }

  async function onSetRole(personId: string, role: 'cm' | 'operative') {
    setError('');
    try {
      await repo.setPersonRole(personId, role);
    } catch (err) {
      setError(peopleFailureMessage(err instanceof Error ? err.message : 'Could not change that role'));
      return;
    }
    setRoleFor(null);
    await refreshAfterWrite();
  }

  async function onInvite(personId: string) {
    setLoading(true);
    setError('');
    try {
      await repo.attachLogin(personId, inviteEmail);
      setInviteFor(null);
      setInviteEmail('');
    } catch (err) {
      setError(peopleFailureMessage(err instanceof Error ? err.message : 'Could not send the invite'));
      return;
    } finally {
      setLoading(false);
    }
    await refreshAfterWrite();
  }

  return (
    <Screen footer={person ? <AppTabs role={person.role} /> : null}>
      <Title>People</Title>
      {person && canManageSite(person.role) ? (
        <Button label="Invite" minHeight={56} onPress={() => router.push('/invite')} />
      ) : null}
      <Link href="/groups" asChild>
        <Pressable accessibilityRole="link" style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={textStyle.bodyStrong}>Groups</Text>
        </Pressable>
      </Link>
      <ErrorText>{error}</ErrorText>
      {loaded && !error && people.length === 0 ? <EmptyState icon="group" title="No one in the company yet" /> : null}
      {pinnedOwnerFirst(people).map((row) => {
        const mine = removableSites(row, sites);
        const invite = person ? canAttachLogin(person.role, row, sites) : false;
        const change =
          person && canOfferSiteManagerChange(person.role, person.id, row) ? siteManagerChange(row.role) : null;
        const menuItems = [
          ...(change
            ? [
                {
                  label: change.label,
                  onPress: () => {
                    setRemoveFor(null);
                    setRoleFor(row.id);
                    setError('');
                  },
                },
              ]
            : []),
          ...mine.map((site) => ({
            label: `Remove from ${site.name}`,
            danger: true,
            onPress: () => {
              setRoleFor(null);
              setRemoveFor({ personId: row.id, siteId: site.site_id });
            },
          })),
        ];
        return (
          <Card key={row.id}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
              <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                <Text style={{ ...textStyle.bodyStrong }}>{personLabel(row)}</Text>
                <Muted>{occupationLine(row.role, row.trade)}</Muted>
                <Text style={{ color: theme.text }}>{siteLabel(row.site_names)}</Text>
              </View>
              {menuItems.length > 0 ? (
                <OverflowMenu label={`More for ${personLabel(row)}`} title={personLabel(row)} items={menuItems} />
              ) : null}
            </View>
            {change && roleFor === row.id ? (
              <View style={{ gap: space.sm }}>
                <Text style={textStyle.body}>{change.confirm(personLabel(row))}</Text>
                <Button
                  label={change.label}
                  variant={change.next === 'cm' ? 'primary' : 'danger'}
                  minHeight={change.next === 'cm' ? 56 : 48}
                  onPress={() => void onSetRole(row.id, change.next)}
                />
                <Button label="Cancel" variant="secondary" minHeight={48} onPress={() => setRoleFor(null)} />
              </View>
            ) : null}
            {removeFor?.personId === row.id ? (
              <View style={{ gap: space.sm }}>
                <Text style={textStyle.body}>
                  Remove {personLabel(row)} from {mine.find((site) => site.site_id === removeFor.siteId)?.name}?
                </Text>
                <Button
                  label="Remove"
                  variant="danger"
                  minHeight={48}
                  onPress={() => void onRemove(row.id, removeFor.siteId)}
                />
                <Button label="Cancel" variant="secondary" minHeight={48} onPress={() => setRemoveFor(null)} />
              </View>
            ) : null}
            {invite && inviteFor !== row.id ? (
              <Button
                label="Invite"
                variant="secondary"
                onPress={() => {
                  setInviteFor(row.id);
                  setInviteEmail('');
                  setError('');
                }}
              />
            ) : null}
            {invite && inviteFor === row.id ? (
              <View style={{ gap: 8 }}>
                <Field
                  label="Email"
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  keyboardType="email-address"
                  placeholder="name@company.test"
                />
                <Button
                  label="Send invite"
                  variant="secondary"
                  onPress={() => void onInvite(row.id)}
                  loading={loading}
                  disabled={!inviteEmail.trim()}
                />
              </View>
            ) : null}
          </Card>
        );
      })}
      {loaded ? (
        <>
          <Title>Add a person</Title>
          <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Lee Stone" />
          <Field label="Occupation" value={trade} onChangeText={setTrade} placeholder="Optional" />
          <Text style={{ color: theme.muted, fontWeight: '700' }}>Sites</Text>
          {sites.map((site) => {
            const on = siteIds.includes(site.site_id);
            return (
              <Pressable
                key={site.site_id}
                accessibilityRole="button"
                onPress={() => toggleSite(site.site_id)}
                style={{
                  minHeight: 48,
                  justifyContent: 'center',
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: on ? theme.text : theme.line,
                  backgroundColor: on ? theme.text : 'transparent',
                }}>
                <Text style={[textStyle.bodyStrong, { color: on ? theme.bg : theme.text }]}>{site.name}</Text>
              </Pressable>
            );
          })}
          <Button
            label="Add person"
            variant="secondary"
            onPress={() => void onAdd()}
            loading={loading}
            disabled={!canAddNoLogin(callerRole, name, siteIds)}
          />
        </>
      ) : null}
    </Screen>
  );
}
