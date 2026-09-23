import { useAuth } from '@/context/AuthContext';
import { theme } from '@/lib/theme';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

export default function Index() {
  const { ready, person, needsPassword } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.current} />
      </View>
    );
  }
  if (!person) return <Redirect href="/login" />;
  if (needsPassword) return <Redirect href="/set-password" />;
  return <Redirect href="/sites" />;
}
