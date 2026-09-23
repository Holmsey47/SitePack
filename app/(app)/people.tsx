import { Button, Card, EmptyState, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { canAddNoLogin, canAttachLogin, loginLabel, peopleFailureMessage, removableSites, roleLabel, siteLabel } from '@/data/companyPeople';
import { repo } from '@/data/index';
import type { CompanyPerson, PulseRow } from '@/data/types';
import { theme } from '@/lib/theme';
import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function PeopleScreen() {
  const { person } = useAuth();
  const [people, setPeople] = useState<CompanyPerson[]>([]);
  const [sites, setSites] = useState<PulseRow[]>([]);
  const [name, setName] = useState('');
  const [trade, setTrade] = useState('');
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [inviteFor, setInviteFor] = useState<string | null>(null);
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
      setError(peopleFailureMessage(err instanceof Error ? err.message : 'Could not load people'));
    }
  }

  useFocusEffect(
    useCallback(() => {
      if (!person || person.role === 'operative') return;
      load().catch((err: unknown) => {
        setError(peopleFailureMessage(err instanceof Error ? err.message : 'Could not load people'));
      });
    }, [load, person])
  );

  if (person?.role === 'operative') return <Redirect href="/home" />;

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
    <Screen>
      <Title>People</Title>
      <Muted>Everyone in the company. A name with no login is still on the list.</Muted>
      <ErrorText>{error}</ErrorText>
      {loaded && !error && people.length === 0 ? <EmptyState title="No one in the company yet" /> : null}
      {people.map((row) => {
        const mine = removableSites(row, sites);
        const invite = person ? canAttachLogin(person.role, row, sites) : false;
        return (
          <Card key={row.id}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{row.display_name}</Text>
            <Muted>
              {roleLabel(row.role)}
              {row.trade ? ` · ${row.trade}` : ''}
            </Muted>
            <Text style={{ color: theme.text }}>{siteLabel(row.site_names)}</Text>
            <Muted>{loginLabel(row.has_login)}</Muted>
            {mine.map((site) => (
              <Button
                key={site.site_id}
                label={`Remove from ${site.name}`}
                variant="ghost"
                onPress={() => void onRemove(row.id, site.site_id)}
              />
            ))}
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
          <Title>Add a name</Title>
          <Muted>
            {callerRole === 'cm'
              ? 'Name and a site you are on. No email and no password until you invite them.'
              : 'Name, and sites if you want. No email and no password until you invite them.'}
          </Muted>
          <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Lee Stone" />
          <Field label="Trade label" value={trade} onChangeText={setTrade} placeholder="labourer" />
          <Text style={{ color: theme.muted, fontWeight: '700' }}>Sites</Text>
          {callerRole === 'owner' ? <Muted>Leave every site off to add a name with no site.</Muted> : null}
          {sites.map((site) => {
            const on = siteIds.includes(site.site_id);
            return (
              <Pressable
                key={site.site_id}
                accessibilityRole="button"
                onPress={() => toggleSite(site.site_id)}
                style={{
                  minHeight: 44,
                  justifyContent: 'center',
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: on ? theme.current : theme.line,
                }}>
                <Text style={{ color: theme.text }}>{site.name}</Text>
              </Pressable>
            );
          })}
          <Button
            label="Add name"
            onPress={() => void onAdd()}
            loading={loading}
            disabled={!canAddNoLogin(callerRole, name, siteIds)}
          />
        </>
      ) : null}
    </Screen>
  );
}
