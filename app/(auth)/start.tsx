import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { repo } from '@/data';
import { CHECK_YOUR_EMAIL, startFailureMessage } from '@/data/startCompany';
import { theme } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

export default function StartCompanyScreen() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError('');
    setLoading(true);
    try {
      const result = await repo.startCompany({ companyName, fullName, email });
      if (result.message !== CHECK_YOUR_EMAIL) {
        setError(startFailureMessage('start_failed'));
        return;
      }
      setSent(true);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'start_failed';
      setError(startFailureMessage(code));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <Screen>
        <Text style={{ color: theme.current, fontWeight: '800', letterSpacing: 1.4 }}>SITEPACK</Text>
        <Title>{CHECK_YOUR_EMAIL}</Title>
        <Muted>Open the invite and set your password.</Muted>
        <Button label="Back" variant="secondary" minHeight={48} onPress={() => router.replace('/welcome')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={{ color: theme.current, fontWeight: '800', letterSpacing: 1.4 }}>SITEPACK</Text>
      <Title>Start my company</Title>
      <Muted>We’ll email you a link to set a password.</Muted>
      <Field
        label="Company name"
        value={companyName}
        onChangeText={setCompanyName}
        autoCapitalize="words"
        maxLength={80}
        placeholder="Acme Drylining"
      />
      <Field
        label="Your name"
        value={fullName}
        onChangeText={setFullName}
        autoCapitalize="words"
        maxLength={80}
        placeholder="Ada Owner"
      />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        maxLength={254}
        placeholder="you@company.com"
      />
      <ErrorText>{error}</ErrorText>
      <Button
        label="Start my company"
        minHeight={48}
        onPress={() => void onSubmit()}
        loading={loading}
        disabled={!companyName.trim() || !fullName.trim() || !email.trim()}
      />
    </Screen>
  );
}
