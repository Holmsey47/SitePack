import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { textStyle, theme } from '@/lib/theme';

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Missing' }} />
      <View style={{ flex: 1, backgroundColor: theme.bg, padding: 24, gap: 12 }}>
        <Text style={{ ...textStyle.title }}>That screen is not in v0</Text>
        <Link href="/" style={textStyle.bodyStrong}>
          Back to SitePack
        </Link>
      </View>
    </>
  );
}
