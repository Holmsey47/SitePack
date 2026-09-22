import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { spentInviteGuidance } from '@/lib/inviteGrant';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

export default function SetPasswordScreen() {
  const { setPassword, signOut } = useAuth();
  const router = useRouter();
  const [password, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError('');
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await setPassword(password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not set password.';
      if (message.toLowerCase().includes('different from the old password')) {
        const pageUrl = typeof window !== 'undefined' ? window.location.href : null;
        setError(spentInviteGuidance(pageUrl));
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 8, paddingTop: 24 }}>
        <Title>Set your password</Title>
        <Muted>One time from your invite. After this, sign in with email + password — SitePack will not email a magic link.</Muted>
      </View>
      <Field label="New password" value={password} onChangeText={setValue} secureTextEntry />
      <Field label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry />
      <ErrorText>{error}</ErrorText>
      <Button label="Save password" onPress={onSubmit} loading={loading} />
      <Button
        label="Cancel"
        variant="ghost"
        onPress={() => {
          void signOut().then(() => router.replace('/login'));
        }}
      />
    </Screen>
  );
}
