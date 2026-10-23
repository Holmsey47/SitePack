import { Button, Muted, Screen, SeenRejectNotice, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { classifyShareFailure, shareFailureNotice, withShareRetry } from '@/data/sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

export default function OpenShareScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const routeCode = Array.isArray(code) ? code[0] : (code ?? '');
  const { person } = useAuth();
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  async function onOpen() {
    if (!routeCode) return;
    setNotice('');
    setLoading(true);
    try {
      const opened = await withShareRetry(() => repo.redeemSiteShare(routeCode));
      router.replace(`/sites/${opened.siteId}/shared`);
    } catch (error) {
      setNotice(shareFailureNotice(classifyShareFailure(error)));
    } finally {
      setLoading(false);
    }
  }

  if (!person) {
    return (
      <Screen>
        <Title>Open a share</Title>
        <Muted>Sign in to your company, then open this link again. The code joins a site your company can view. It does not put you in the other company.</Muted>
        <Button label="Sign in" onPress={() => router.push('/login')} />
        <Button label="Join your company" variant="secondary" minHeight={48} onPress={() => router.push('/join')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Open a share</Title>
      <Muted>This opens one site for your company to view. You stay in your company.</Muted>
      {notice ? <SeenRejectNotice message={notice} onDismiss={() => setNotice('')} /> : null}
      <Button label="Open this site" onPress={() => void onOpen()} loading={loading} disabled={!routeCode} />
    </Screen>
  );
}
