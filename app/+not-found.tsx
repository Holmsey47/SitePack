import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { theme } from '@/lib/theme';

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Missing' }} />
      <View style={{ flex: 1, backgroundColor: theme.bg, padding: 24, gap: 12 }}>
        <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>That screen is not in v0</Text>
        <Link href="/" style={{ color: theme.current, fontSize: 17, fontWeight: '700' }}>
          Back to SitePack
        </Link>
      </View>
    </>
  );
}
