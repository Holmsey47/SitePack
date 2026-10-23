import { HardwareBackHandler } from '@/components/HardwareBackHandler';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { theme } from '@/lib/theme';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import 'expo-sqlite/localStorage/install';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Gate />
      </AuthProvider>
      <HardwareBackHandler />
    </SafeAreaProvider>
  );
}

function Gate() {
  const { ready, person, needsPassword, linkError } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let meta = document.querySelector('meta[name="referrer"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'referrer');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'no-referrer');
  }, []);

  useEffect(() => {
    if (!ready) return;
    const parts = [...segments] as string[];
    const inAuth = parts[0] === '(auth)';
    const screen = parts[1] ?? '';
    const publicJoin = parts[0] === 'join' || parts[0] === 'reset' || parts[0] === 'share';
    if (!person && screen !== 'login' && !publicJoin) {
      router.replace('/login');
      return;
    }
    if (person && needsPassword && screen !== 'set-password') {
      router.replace('/set-password');
      return;
    }
    if (person && !needsPassword && inAuth) {
      router.replace('/sites');
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
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {linkError ? (
        <SafeAreaView edges={['top']} style={{ backgroundColor: theme.bg }}>
          <View accessibilityRole="alert" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            <Text style={{ color: theme.danger, fontSize: 16, lineHeight: 22 }}>{linkError}</Text>
          </View>
        </SafeAreaView>
      ) : null}
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
        <Stack.Screen name="join" options={{ title: 'Join a site' }} />
        <Stack.Screen name="reset" options={{ title: 'New password' }} />
        <Stack.Screen name="share" options={{ title: 'Open a share' }} />
      </Stack>
    </View>
  );
}
