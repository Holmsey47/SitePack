import { Button, Screen, Title } from '@/components/ui';
import { theme } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { Image, Text, View } from 'react-native';

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <Screen>
      <View style={{ gap: 12, paddingTop: 24, alignItems: 'flex-start' }}>
        <Image source={require('@/assets/images/icon.png')} style={{ width: 72, height: 72, borderRadius: 16 }} />
        <Text style={{ color: theme.current, fontWeight: '800', letterSpacing: 1.4 }}>SITEPACK</Text>
        <Title>Welcome</Title>
      </View>
      <Button label="Start my company" minHeight={48} onPress={() => router.push('/start')} />
      <Button
        label="I've got an invite"
        variant="secondary"
        minHeight={48}
        onPress={() => router.push('/join')}
      />
      <Button label="Log in" variant="secondary" minHeight={48} onPress={() => router.push('/login')} />
    </Screen>
  );
}
