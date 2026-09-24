import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { sitesAfterReload } from '@/data/siteList';
import type { PulseRow, Role } from '@/data/types';
import { roleLabel, workingRows } from '@/data/walk';
import { theme } from '@/lib/theme';
import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

const ROLES: Role[] = ['operative', 'cm', 'owner'];

export default function InviteScreen() {
  const { person } = useAuth();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('operative');
  const [trade, setTrade] = useState('');
  const [sites, setSites] = useState<PulseRow[]>([]);
  const [siteIds, setSiteIds] = useState<string[]>([]);
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
          setSites(workingRows(next.sites));
          setListNotice(next.notice);
        })
        .catch(() => {
          setSites((current) => sitesAfterReload(null, current).sites);
          setListNotice(sitesAfterReload(null, []).notice);
        });
    }, [person])
  );

  if (person && !canManageSite(person.role)) return <Redirect href="/sites" />;

  const allowedRoles = person?.role === 'cm' ? (['operative'] as Role[]) : ROLES;

  function toggleSite(siteId: string) {
    setSiteIds((current) => (current.includes(siteId) ? current.filter((id) => id !== siteId) : [...current, siteId]));
  }

  async function onSubmit() {
    setLoading(true);
    setError('');
    try {
      await repo.invitePerson({
        email,
        displayName,
        role,
        trade: trade.trim() || null,
        siteIds,
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
        <Title>
          Invite sent to {displayName.trim()}, {email.trim()}.
        </Title>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Invite someone</Title>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="Name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
      <Field label="Occupation" value={trade} onChangeText={setTrade} placeholder="Optional" />
      <Text style={{ color: theme.muted, fontWeight: '700' }}>Role</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {allowedRoles.map((value) => (
          <Pressable
            key={value}
            onPress={() => setRole(value)}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: role === value ? theme.current : theme.surface,
            }}>
            <Text style={{ color: role === value ? theme.currentInk : theme.text, fontWeight: '700' }}>
              {roleLabel(value)}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ color: theme.muted, fontWeight: '700' }}>Sites</Text>
      {listNotice ? <Text style={{ color: theme.muted }}>{listNotice}</Text> : null}
      {sites.map((site) => {
        const on = siteIds.includes(site.site_id);
        return (
          <Pressable
            key={site.site_id}
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
