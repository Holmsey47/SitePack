import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { SEED_LOGINS, SEED_PASSWORD } from '@/data/ids';
import { theme } from '@/lib/theme';
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

export default function LoginScreen() {
  const { signIn, usingFixtures } = useAuth();
  const showSeedChips = __DEV__ && usingFixtures;
  const [email, setEmail] = useState(showSeedChips ? 'amy@sitepack.test' : '');
  const [password, setPassword] = useState(showSeedChips ? SEED_PASSWORD : '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t sign in. Check email and password and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 12, paddingTop: 24, alignItems: 'flex-start' }}>
        <Image source={require('@/assets/images/icon.png')} style={{ width: 72, height: 72, borderRadius: 16 }} />
        <Text style={{ color: theme.current, fontWeight: '800', letterSpacing: 1.4 }}>SITEPACK</Text>
        <Title>Sign in</Title>
      </View>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="you@company.test" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Your password" />
      <ErrorText>{error}</ErrorText>
      <Button label="Sign in" onPress={onSubmit} loading={loading} disabled={!email || !password} />
      {showSeedChips ? (
        <View style={{ gap: 10, paddingTop: 8 }}>
          {SEED_LOGINS.map((login) => (
            <Pressable
              key={login.email}
              onPress={() => {
                setEmail(login.email);
                setPassword(SEED_PASSWORD);
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
