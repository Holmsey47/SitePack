import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { formatJoinCode, publicCodePath, resetFailureMessage } from '@/data/joinCodes';
import { clearStagedResetCode, peekStagedResetCode, stageResetCode } from '@/lib/appLinks';
import { theme } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text } from 'react-native';

export function ResetScreen({ routeCode }: { routeCode?: string }) {
  const { redeemPasswordReset } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState(() => formatJoinCode(routeCode || peekStagedResetCode()));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (!routeCode || typeof window === 'undefined') return;
      const strip = () => {
        const next = publicCodePath(window.location.pathname);
        if (next) window.history.replaceState(window.history.state, '', next);
      };
      strip();
      const id = window.setTimeout(strip, 0);
      return () => window.clearTimeout(id);
    }
    if (routeCode) {
      stageResetCode(routeCode);
      router.replace('/reset');
      return;
    }
    const staged = peekStagedResetCode();
    if (staged) setCode(formatJoinCode(staged));
    clearStagedResetCode();
  }, [routeCode, router]);

  async function onSubmit() {
    setError('');
    setLoading(true);
    try {
      await redeemPasswordReset(code, password);
      setDone(true);
    } catch (err) {
      setError(resetFailureMessage(err instanceof Error ? err.message : 'reset_rejected'));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>Password saved</Title>
        <Muted>Sign in with your username and the new password.</Muted>
        <Button label="Sign in" onPress={() => router.replace('/login')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={{ color: theme.current, fontWeight: '800', letterSpacing: 1.4 }}>SITEPACK</Text>
      <Title>New password</Title>
      <Muted>Type the reset code your manager sent. It lasts 30 minutes and works once.</Muted>
      <Field label="Reset code" value={code} onChangeText={setCode} autoCapitalize="words" placeholder="XXXX-XXXX" />
      <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Letters and digits" />
      <ErrorText>{error}</ErrorText>
      <Button label="Save password" onPress={() => void onSubmit()} loading={loading} disabled={!code.trim() || !password} />
    </Screen>
  );
}
