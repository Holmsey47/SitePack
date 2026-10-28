import { Button, Card, ErrorText, Muted, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { JOIN_WEB_ORIGIN, joinFailureMessage, resetFailureMessage, resetShareText } from '@/data/joinCodes';
import type { JoinerRow, PasswordResetIssued } from '@/data/types';
import { timeAgo } from '@/lib/format';
import { textStyle, theme } from '@/lib/theme';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';

export default function WhoJoinedScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const [rows, setRows] = useState<JoinerRow[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<JoinerRow | null>(null);
  const [revokeCode, setRevokeCode] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [resetFor, setResetFor] = useState<PasswordResetIssued | null>(null);
  const [resetName, setResetName] = useState('');

  const load = useCallback(() => {
    if (!siteId) return;
    repo
      .listJoiners(siteId)
      .then(setRows)
      .catch(() => setError('Could not load who joined.'));
  }, [siteId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (person && !canManageSite(person.role)) return <Redirect href="/sites" />;

  async function onRemove() {
    if (!pending?.person_id || !siteId) return;
    setRemoving(true);
    setError('');
    try {
      await repo.removeJoiner(pending.person_id, siteId, revokeCode);
      setPending(null);
      setRevokeCode(false);
      setResetFor(null);
      setResetName('');
      load();
    } catch (err) {
      setError(joinFailureMessage(err instanceof Error ? err.message : 'not_authorized'));
    } finally {
      setRemoving(false);
    }
  }

  async function onReset(row: JoinerRow) {
    if (!row.person_id) return;
    setError('');
    setResetFor(null);
    try {
      const issued = await repo.issuePasswordReset(row.person_id);
      setResetName(row.display_name || 'them');
      setResetFor(issued);
    } catch (err) {
      setError(resetFailureMessage(err instanceof Error ? err.message : 'not_authorized'));
    }
  }

  const resetMessage = resetFor ? resetShareText(resetName, resetFor.code, JOIN_WEB_ORIGIN) : '';
  const owner = person?.role === 'owner';

  return (
    <Screen>
      <Muted>
        {owner
          ? 'Name, trade, and which code. Remove takes them off the company.'
          : 'Name, trade, and which code. Remove takes them off this site.'}
      </Muted>
      <ErrorText>{error}</ErrorText>
      {rows.length === 0 ? <Muted>Nobody has joined with a code yet.</Muted> : null}
      {rows.map((row) => (
        <Card key={row.id}>
          <Text style={{ ...textStyle.bodyStrong }}>{row.display_name || 'Unknown'}</Text>
          <Muted>
            {row.trade || 'No trade'}
            {row.username ? ` · ${row.username}` : ''}
          </Muted>
          <Muted>
            {row.code_label || 'Code'} · {timeAgo(row.joined_at)}
          </Muted>
          {row.removed_at ? <Text style={{ color: theme.danger, fontWeight: '800' }}>Removed</Text> : null}
          {!row.removed_at && row.person_id ? (
            <View style={{ gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setRevokeCode(false);
                  setPending(row);
                }}
                style={{ minHeight: 48, justifyContent: 'center' }}>
                <Text style={{ ...textStyle.bodyStrong, color: theme.danger }}>Remove</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void onReset(row)}
                style={{ minHeight: 48, justifyContent: 'center' }}>
                <Text style={{ ...textStyle.bodyStrong }}>Reset password</Text>
              </Pressable>
            </View>
          ) : null}
        </Card>
      ))}

      {pending ? (
        <Card>
          <Text style={{ ...textStyle.title }}>
            {owner
              ? `Remove ${pending.display_name || 'them'} from the company?`
              : `Remove ${pending.display_name || 'them'} from this site?`}
          </Text>
          {owner ? (
            <>
              <Muted>They lose this site and can’t sign in.</Muted>
              <Muted>Downloaded drawings stay on their phone. SitePack can’t pull them back.</Muted>
            </>
          ) : (
            <Muted>They lose this site. They can still sign in on any other site.</Muted>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ checked: revokeCode }}
            onPress={() => setRevokeCode((value) => !value)}
            style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={{ ...textStyle.bodyStrong }}>
              {revokeCode ? '✓ ' : ''}Also revoke this code
            </Text>
          </Pressable>
          <Button label={revokeCode ? 'Remove and revoke code' : 'Remove'} variant="danger" onPress={() => void onRemove()} loading={removing} />
          <Button label="Cancel" variant="ghost" onPress={() => setPending(null)} />
        </Card>
      ) : null}

      {resetFor ? (
        <Card>
          <Text style={{ ...textStyle.title }}>Reset code</Text>
          <Text selectable style={{ ...textStyle.display, letterSpacing: 1 }}>
            {resetFor.code}
          </Text>
          <Muted>Pass this on by WhatsApp. You never see their new password. It works once, for 30 minutes.</Muted>
          <Text selectable style={{ ...textStyle.meta }}>
            {resetMessage}
          </Text>
          <Button
            label="Share reset code"
            onPress={() => {
              void Share.share({ message: resetMessage }).catch(() => undefined);
            }}
          />
          <Button label="Done" variant="ghost" onPress={() => setResetFor(null)} />
        </Card>
      ) : null}
    </Screen>
  );
}
