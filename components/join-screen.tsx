import { Button, ErrorText, Field, LogoSlot, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { joinFailureMessage, publicCodePath, formatJoinCode } from '@/data/joinCodes';
import { clearStagedJoinCode, peekStagedJoinCode, stageJoinCode } from '@/lib/appLinks';
import { logo } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * The form is the only check. Opening the link does not call the server.
 * The code is lifted into state and stripped from the address bar.
 */
export function JoinScreen({ routeCode }: { routeCode?: string }) {
  const { joinWithCode } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState(() =>
    formatJoinCode(routeCode || peekStagedJoinCode())
  );
  const [name, setName] = useState('');
  const [trade, setTrade] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (!routeCode || typeof window === 'undefined') return;
      // The router writes the code into the address bar after this effect.
      // Strip again on the next turn so the code does not stay in the URL.
      const strip = () => {
        const next = publicCodePath(window.location.pathname);
        if (next) window.history.replaceState(window.history.state, '', next);
      };
      strip();
      const id = window.setTimeout(strip, 0);
      return () => window.clearTimeout(id);
    }
    if (routeCode) {
      stageJoinCode(routeCode);
      router.replace('/join');
      return;
    }
    const staged = peekStagedJoinCode();
    if (staged) setCode(formatJoinCode(staged));
    clearStagedJoinCode();
  }, [routeCode, router]);

  async function onSubmit() {
    setError('');
    setLoading(true);
    try {
      const siteId = await joinWithCode({
        code,
        displayName: name,
        trade,
        username,
        password,
      });
      router.replace(`/sites/${siteId}`);
    } catch (err) {
      const codeName = err instanceof Error ? err.message : 'join_rejected';
      setError(joinFailureMessage(codeName));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <LogoSlot size={logo.welcome} />
      <Title>Join a site</Title>
      <Muted>Enter the code from your message. You’ll set a username and password.</Muted>
      <Field label="Code" value={code} onChangeText={setCode} autoCapitalize="words" placeholder="XXXX-XXXX" />
      <Field label="Your name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Sam Reed" />
      <Field label="Trade" value={trade} onChangeText={setTrade} autoCapitalize="words" placeholder="Fixer" />
      <Field label="Username" value={username} onChangeText={setUsername} placeholder="samreed" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Letters and digits" />
      <ErrorText>{error}</ErrorText>
      <Button
        label="Join"
        onPress={() => void onSubmit()}
        loading={loading}
        disabled={!code.trim() || !name.trim() || !username.trim() || !password}
      />
    </Screen>
  );
}
