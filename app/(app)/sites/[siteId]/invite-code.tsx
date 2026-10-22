import { JoinSharePanel } from '@/components/JoinSharePanel';
import { Button, Card, ChoiceChip, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import {
  JOIN_DEFAULT_HOURS,
  JOIN_DEFAULT_MAX_USES,
  JOIN_HARD_MAX_USES,
  expiryChoiceHours,
  joinFailureMessage,
} from '@/data/joinCodes';
import type { JoinCodeCreated, JoinCodeRow } from '@/data/types';
import { formatCodeExpiry } from '@/lib/format';
import { theme } from '@/lib/theme';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

const HOURS = [
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
] as const;

export default function InviteCodeScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState(String(JOIN_DEFAULT_MAX_USES));
  const [hours, setHours] = useState<number>(JOIN_DEFAULT_HOURS);
  const [codes, setCodes] = useState<JoinCodeRow[]>([]);
  const [share, setShare] = useState<JoinCodeCreated | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<JoinCodeRow | null>(null);

  const load = useCallback(() => {
    if (!siteId) return;
    repo
      .listJoinCodes(siteId)
      .then(setCodes)
      .catch(() => setError('Could not load codes.'));
  }, [siteId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (person && !canManageSite(person.role)) return <Redirect href="/sites" />;

  const active = codes.filter((row) => !row.revoked_at && new Date(row.expires_at).getTime() > Date.now());

  async function onCreate() {
    if (!siteId) return;
    setLoading(true);
    setError('');
    const parsed = Number.parseInt(maxUses, 10);
    try {
      const created = await repo.createJoinCode({
        siteId,
        label,
        maxUses: Number.isFinite(parsed) ? parsed : JOIN_DEFAULT_MAX_USES,
        hours,
      });
      setShare(created);
      setLabel('');
      load();
    } catch (err) {
      setError(joinFailureMessage(err instanceof Error ? err.message : 'join_rejected'));
    } finally {
      setLoading(false);
    }
  }

  async function onRevoke() {
    if (!pendingRevoke) return;
    setError('');
    try {
      await repo.revokeJoinCode(pendingRevoke.id);
      setPendingRevoke(null);
      load();
    } catch (err) {
      setError(joinFailureMessage(err instanceof Error ? err.message : 'not_authorized'));
    }
  }

  async function onShareAgain(row: JoinCodeRow) {
    if (!siteId) return;
    setError('');
    setLoading(true);
    try {
      const created = await repo.createJoinCode({
        siteId,
        label: row.label ?? '',
        maxUses: row.max_uses,
        hours: expiryChoiceHours(row.created_at, row.expires_at),
      });
      await repo.revokeJoinCode(row.id);
      setShare(created);
      load();
    } catch (err) {
      setError(joinFailureMessage(err instanceof Error ? err.message : 'not_authorized'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Title>Invite to this site</Title>
      <Muted>A valid code puts them straight on this site. No approval step.</Muted>
      <Field label="Label" value={label} onChangeText={setLabel} autoCapitalize="words" placeholder="Oak fixers" />
      <Field
        label="Max uses"
        value={maxUses}
        onChangeText={setMaxUses}
        placeholder={String(JOIN_DEFAULT_MAX_USES)}
        keyboardType="number-pad"
      />
      <Muted>Hard max {JOIN_HARD_MAX_USES}. Pre-filled with {JOIN_DEFAULT_MAX_USES}.</Muted>
      <Text style={{ color: theme.muted, fontWeight: '700' }}>How long it lasts</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {HOURS.map((option) => (
          <ChoiceChip
            key={option.hours}
            label={option.label}
            selected={hours === option.hours}
            onPress={() => setHours(option.hours)}
          />
        ))}
      </View>
      <ErrorText>{error}</ErrorText>
      <Button label="Create code" onPress={() => void onCreate()} loading={loading} />

      {share ? (
        <JoinSharePanel
          code={share.code}
          siteName={share.site_name}
          expiresAt={share.expires_at}
          uses={0}
          maxUses={share.max_uses}
        />
      ) : null}

      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>ACTIVE CODES</Text>
      {active.length === 0 ? <Muted>No active codes.</Muted> : null}
      {active.map((row) => (
        <Card key={row.id}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{row.label || 'No label'}</Text>
          <Muted>
            {row.uses} of {row.max_uses} used · {formatCodeExpiry(row.expires_at)}
          </Muted>
          <Button label="Share again" variant="secondary" onPress={() => void onShareAgain(row)} />
          <Button label="Revoke" variant="danger" onPress={() => setPendingRevoke(row)} />
        </Card>
      ))}

      {pendingRevoke ? (
        <Card>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>
            {`Revoke ${pendingRevoke.label || 'this'} code? Anyone who hasn't joined yet can't use it.`}
          </Text>
          <Button label="Revoke code" variant="danger" onPress={() => void onRevoke()} />
          <Button label="Cancel" variant="ghost" onPress={() => setPendingRevoke(null)} />
        </Card>
      ) : null}
    </Screen>
  );
}
