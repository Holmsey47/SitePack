import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { SEED_LOGINS, SEED_PASSWORD } from '@/data/ids';
import { theme } from '@/lib/theme';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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
      <View style={{ gap: 8, paddingTop: 24 }}>
        <Text style={{ color: theme.current, fontWeight: '800', letterSpacing: 1.4 }}>SITEPACK</Text>
        <Title>Enter with your invite password</Title>
        <Muted>No public signup. If you were invited, set a password from that email once — then use email + password here.</Muted>
      </View>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="you@company.test" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Your password" />
      <ErrorText>{error}</ErrorText>
      <Button label="Sign in" onPress={onSubmit} loading={loading} disabled={!email || !password} />
      {showSeedChips ? (
        <View style={{ gap: 10, paddingTop: 8 }}>
          <Muted>Local seed logins (password {SEED_PASSWORD})</Muted>
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
