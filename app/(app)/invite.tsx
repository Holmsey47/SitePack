import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { sitesAfterReload } from '@/data/siteList';
import type { PulseRow, Role } from '@/data/types';
import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { theme } from '@/lib/theme';

const ROLES: Role[] = ['operative', 'cm', 'owner'];

export default function InviteScreen() {
  const { person } = useAuth();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('operative');
  const [trade, setTrade] = useState('');
  const [sites, setSites] = useState<PulseRow[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [listNotice, setListNotice] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!person || person.role === 'operative') return;
      repo
        .companySitesPulse()
        .then((rows) => {
          const next = sitesAfterReload(rows, []);
          setSites(next.sites);
          setListNotice(next.notice);
        })
        .catch(() => {
          setSites((current) => sitesAfterReload(null, current).sites);
          setListNotice(sitesAfterReload(null, []).notice);
        });
    }, [person])
  );

  if (person && !canManageSite(person.role)) return <Redirect href="/home" />;

  const allowedRoles = person?.role === 'cm' ? (['operative'] as Role[]) : ROLES;

  async function onSubmit() {
    setLoading(true);
    setError('');
    try {
      await repo.invitePerson({
        email,
        displayName,
        role,
        trade: trade.trim() || null,
        siteId,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>Invite sent</Title>
        <Muted>They set a password from the email once, then sign in with email + password. No open signup.</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Invite someone</Title>
      <Muted>Invite link + password. Trade is a label (dryliner, plasterer, labourer, …).</Muted>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="Name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
      <Field label="Trade label" value={trade} onChangeText={setTrade} placeholder="labourer" />
      <Text style={{ color: theme.muted, fontWeight: '700' }}>Role</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {allowedRoles.map((value) => (
          <Pressable
            key={value}
            onPress={() => setRole(value)}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: role === value ? theme.current : theme.surface,
            }}>
            <Text style={{ color: role === value ? theme.currentInk : theme.text, fontWeight: '700' }}>{value}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ color: theme.muted, fontWeight: '700' }}>Assign to site (optional)</Text>
      {listNotice ? <Muted>{listNotice}</Muted> : null}
      {sites.map((site) => (
        <Pressable
          key={site.site_id}
          onPress={() => setSiteId(site.site_id === siteId ? null : site.site_id)}
          style={{
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: siteId === site.site_id ? theme.current : theme.line,
          }}>
          <Text style={{ color: theme.text }}>{site.name}</Text>
        </Pressable>
      ))}
      <ErrorText>{error}</ErrorText>
      <Button
        label="Send invite"
        onPress={() => void onSubmit()}
        loading={loading}
        disabled={!email.trim() || !displayName.trim()}
      />
    </Screen>
  );
}
