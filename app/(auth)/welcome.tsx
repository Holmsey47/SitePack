import { Button, LogoSlot, Muted, Screen, Title } from '@/components/ui';
import { logo, space } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <Screen>
      <View style={{ gap: space.md, paddingTop: space.xl, alignItems: 'flex-start' }}>
        <LogoSlot size={logo.welcome} />
        <Title>Welcome</Title>
        <Muted>Drawings for the site, on your phone.</Muted>
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
