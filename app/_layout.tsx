import { HardwareBackHandler } from '@/components/HardwareBackHandler';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { gateRedirect } from '@/lib/authGate';
import { fontFamily, textStyle, theme } from '@/lib/theme';
import { useSitepackFonts } from '@/src/theme/fonts';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import 'expo-sqlite/localStorage/install';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function applyInter() {
  const style = { fontFamily: fontFamily.regular, fontSize: textStyle.body.fontSize, color: theme.text };
  const text = Text as typeof Text & { defaultProps?: { style?: object } };
  text.defaultProps = { ...(text.defaultProps ?? {}), style };
  const input = TextInput as typeof TextInput & { defaultProps?: { style?: object } };
  input.defaultProps = { ...(input.defaultProps ?? {}), style };
}

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
  const [fontsLoaded, fontError] = useSitepackFonts();
  const fontsReady = fontsLoaded || fontError != null;

  useEffect(() => {
    if (!fontsLoaded) return;
    applyInter();
  }, [fontsLoaded]);

  useEffect(() => {
    if (fontsReady && ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsReady, ready]);

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
    const target = gateRedirect({
      ready: true,
      hasPerson: Boolean(person),
      needsPassword,
      segments: parts,
    });
    if (target) router.replace(target);
  }, [ready, person, needsPassword, segments, router]);

  if (!ready || !fontsReady) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.text} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {linkError ? (
        <SafeAreaView edges={['top']} style={{ backgroundColor: theme.bg }}>
          <View accessibilityRole="alert" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            <Text style={[textStyle.meta, { color: theme.danger }]}>{linkError}</Text>
          </View>
        </SafeAreaView>
      ) : null}
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { fontFamily: fontFamily.bold, fontWeight: '700', fontSize: textStyle.title.fontSize },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.bg },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="join" options={{ title: 'Join a site' }} />
        <Stack.Screen name="reset" options={{ title: 'New password' }} />
      </Stack>
    </View>
  );
}
