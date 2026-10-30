import { Button, ChoiceChip, ErrorText, Field, LogoSlot, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { presentLoginFailure } from '@/lib/loginError';
import { logo, space, textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

const PASSWORD_HELP = 'Forgot your password? Ask your manager for a reset code.';

export default function LoginScreen() {
  const { signIn, signInWithUsername } = useAuth();
  const router = useRouter();
  const showSeedChips = process.env.EXPO_PUBLIC_USE_FIXTURES === '1';
  // Metro resolves this to an empty stub unless the fixture flag is on.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const seeds = showSeedChips ? (require('@/data/ids') as typeof import('@/data/ids')) : null;
  const [mode, setMode] = useState<'email' | 'username'>('email');
  const [email, setEmail] = useState(
    seeds?.SEED_LOGINS.find((row) => row.role === 'operative')?.email ?? ''
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(seeds?.SEED_PASSWORD ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError('');
    setLoading(true);
    try {
      if (mode === 'username') await signInWithUsername(username, password);
      else await signIn(email, password);
    } catch (err) {
      const presented = presentLoginFailure(err instanceof Error ? err.message : '');
      setError(presented.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: space.md, paddingTop: space.xl, alignItems: 'flex-start' }}>
        <LogoSlot size={logo.welcome} />
        <Title>Sign in</Title>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <ChoiceChip label="Email" selected={mode === 'email'} onPress={() => setMode('email')} />
        <ChoiceChip label="Username" selected={mode === 'username'} onPress={() => setMode('username')} />
      </View>
      {mode === 'username' ? (
        <Field label="Username" value={username} onChangeText={setUsername} placeholder="bentorres" />
      ) : (
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="you@company.test" />
      )}
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Your password" />
      <ErrorText>{error}</ErrorText>
      <Button
        label="Sign in"
        onPress={onSubmit}
        loading={loading}
        disabled={mode === 'username' ? !username.trim() || !password : !email || !password}
      />
      <Text style={textStyle.body}>{PASSWORD_HELP}</Text>
      <Button label="Use a reset code" variant="secondary" onPress={() => router.push('/reset')} />
      <Button label="Join with a code" variant="secondary" onPress={() => router.push('/join')} />
      {showSeedChips ? (
        <View style={{ gap: 10, paddingTop: 8 }}>
          {seeds?.SEED_LOGINS.map((login) => (
            <Pressable
              key={login.email}
              onPress={() => {
                setEmail(login.email);
                setPassword(seeds.SEED_PASSWORD);
              }}
              style={{ paddingVertical: 8 }}>
              <Text style={{ color: theme.text, fontWeight: '600' }}>
                {login.name} · {login.role}
              </Text>
              <Text style={{ color: theme.muted }}>{login.email}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
