import { AuthProvider, useAuth } from '@/context/AuthContext';
import { theme } from '@/lib/theme';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'expo-sqlite/localStorage/install';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Gate() {
  const { ready, person, needsPassword } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const parts = [...segments] as string[];
    const inAuth = parts[0] === '(auth)';
    const screen = parts[1] ?? '';
    if (!person && !inAuth) {
      router.replace('/login');
      return;
    }
    if (person && needsPassword && screen !== 'set-password') {
      router.replace('/set-password');
      return;
    }
    if (person && !needsPassword && inAuth) {
      router.replace(person.role === 'owner' ? '/sites' : '/home');
    }
  }, [ready, person, needsPassword, segments, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.current} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.bg },
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(app)" options={{ headerShown: false }} />
    </Stack>
  );
}
