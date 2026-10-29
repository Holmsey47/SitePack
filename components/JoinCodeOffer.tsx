import { JoinSharePanel } from '@/components/JoinSharePanel';
import { Button, Card, ErrorText, Muted } from '@/components/ui';
import { repo } from '@/data/index';
import { JOIN_DEFAULT_HOURS, JOIN_DEFAULT_MAX_USES, joinFailureMessage } from '@/data/joinCodes';
import {
  ISSUE_AFTER_REVOKE_FAILED,
  OLD_CODE_STOPS,
  REVOKE_FAILED,
  activeCodeNotice,
  confirmThenRegenerate,
  forgetJoinCode,
  joinCodeRowFromCreated,
  loadJoinCodeScreen,
  rememberJoinCode,
  type ActiveCodeView,
} from '@/lib/joinCodeCache';
import { joinCodeCachePort } from '@/lib/joinCodeCacheStorage';
import { space, textStyle } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

/** Lists the active code. Does not mint one until Make or a confirmed Regenerate. */
export function JoinCodeOffer({ siteId, siteName }: { siteId: string; siteName: string }) {
  const [held, setHeld] = useState<ActiveCodeView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [making, setMaking] = useState(false);
  const loadToken = useRef(0);
  const holdLoad = useRef(false);

  const load = useCallback(() => {
    if (holdLoad.current) return () => undefined;
    const token = ++loadToken.current;
    let active = true;
    loadJoinCodeScreen({
      list: () => repo.listJoinCodes(siteId),
      cache: joinCodeCachePort(),
    })
      .then((next) => {
        if (!active || token !== loadToken.current) return;
        setHeld(next);
        setLoadError('');
        setLoaded(true);
      })
      .catch(() => {
        if (!active || token !== loadToken.current) return;
        setHeld(null);
        setLoaded(true);
        setLoadError('Could not load codes.');
      });
    return () => {
      active = false;
    };
  }, [siteId]);

  useFocusEffect(load);

  async function onMake() {
    holdLoad.current = true;
    const token = ++loadToken.current;
    setMaking(true);
    setError('');
    try {
      const created = await repo.createJoinCode({
        siteId,
        maxUses: JOIN_DEFAULT_MAX_USES,
        hours: JOIN_DEFAULT_HOURS,
      });
      await rememberJoinCode(joinCodeCachePort(), created.id, created.code);
      if (token !== loadToken.current) return;
      setHeld({ kind: 'cached', row: joinCodeRowFromCreated(created), code: created.code });
      setLoadError('');
      setLoaded(true);
    } catch (err) {
      if (token !== loadToken.current) return;
      setError(joinFailureMessage(err instanceof Error ? err.message : 'join_rejected'));
    } finally {
      holdLoad.current = false;
      if (token === loadToken.current) setMaking(false);
    }
  }

  async function onConfirmReplace() {
    if (!held || held.kind === 'empty') return;
    const codeId = held.row.id;
    holdLoad.current = true;
    const token = ++loadToken.current;
    setReplacing(true);
    setError('');
    const result = await confirmThenRegenerate(true, {
      codeId,
      revoke: (id) => repo.revokeJoinCode(id),
      forget: (id) => forgetJoinCode(joinCodeCachePort(), id),
      onRevoked: () => {
        setHeld({ kind: 'empty' });
      },
      issue: () =>
        repo.createJoinCode({
          siteId,
          maxUses: JOIN_DEFAULT_MAX_USES,
          hours: JOIN_DEFAULT_HOURS,
        }),
      remember: async (created) => {
        await rememberJoinCode(joinCodeCachePort(), created.id, created.code);
      },
    });
    if (token !== loadToken.current) return;
    if (result.status === 'cancelled') {
      holdLoad.current = false;
      setReplacing(false);
      return;
    }
    if (result.status === 'revoke_failed') {
      setError(REVOKE_FAILED);
      setConfirming(false);
      holdLoad.current = false;
      setReplacing(false);
      return;
    }
    if (result.status === 'issue_failed') {
      setHeld({ kind: 'empty' });
      setConfirming(false);
      setError(ISSUE_AFTER_REVOKE_FAILED);
      holdLoad.current = false;
      setReplacing(false);
      return;
    }
    setHeld({ kind: 'cached', row: joinCodeRowFromCreated(result.created), code: result.created.code });
    setConfirming(false);
    setError('');
    holdLoad.current = false;
    setReplacing(false);
  }

  const visible = !replacing && held?.kind === 'cached' ? held : null;

  if (!loaded) return <Muted>Loading the code…</Muted>;

  if (loadError) {
    return (
      <View style={{ gap: space.sm }}>
        <ErrorText>{loadError}</ErrorText>
        <Button
          label="Try again"
          variant="secondary"
          minHeight={48}
          onPress={() => {
            setLoaded(false);
            setLoadError('');
            load();
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ gap: space.sm }}>
      {replacing ? <Muted>Replacing the code…</Muted> : null}
      {!replacing && held?.kind === 'elsewhere' ? (
        <Text style={textStyle.body}>{activeCodeNotice(held.row.expires_at)}</Text>
      ) : null}
      {confirming && !replacing ? (
        <Card>
          <Text style={textStyle.bodyStrong}>{OLD_CODE_STOPS}</Text>
          <Button label="Replace code" variant="danger" minHeight={56} onPress={() => void onConfirmReplace()} />
          <Button label="Cancel" variant="secondary" minHeight={48} onPress={() => setConfirming(false)} />
        </Card>
      ) : null}
      {visible ? (
        <JoinSharePanel
          code={visible.code}
          siteName={siteName}
          expiresAt={visible.row.expires_at}
          uses={visible.row.uses}
          maxUses={visible.row.max_uses}
        />
      ) : null}
      {!replacing && !confirming && held && held.kind !== 'empty' ? (
        <Button label="Regenerate" variant="secondary" minHeight={48} onPress={() => setConfirming(true)} />
      ) : null}
      {!replacing && held?.kind === 'empty' ? (
        <Button label="Make a join code" minHeight={56} loading={making} onPress={() => void onMake()} />
      ) : null}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
