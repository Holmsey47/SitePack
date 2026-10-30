import { HardwareBackHandler } from '@/components/HardwareBackHandler';
import { ShellBackButton } from '@/components/shell-back';
import { OfflineQueueSync } from '@/components/offline-queue-sync';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { gateRedirect } from '@/lib/authGate';
import { textStyle, theme } from '@/lib/theme';
import { useSitepackFonts } from '@/src/theme/fonts';
import { CustomFontsProvider, Text, navigationTitleStyle } from '@/src/theme/text';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import 'expo-sqlite/localStorage/install';

SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 250, fade: true });

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
  const customFonts = fontsLoaded && fontError == null;
  const [revealed, setRevealed] = useState(Platform.OS !== 'web');

  useEffect(() => {
    if (Platform.OS !== 'web' || !fontsReady || !ready) return;
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, [fontsReady, ready]);

  useEffect(() => {
    if (!fontsReady || !ready) return;
    SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsReady, ready]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    if (!document.head) return;
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
    <CustomFontsProvider enabled={customFonts}>
      <OfflineQueueSync />
      <View
        style={[
          { flex: 1, backgroundColor: theme.bg },
          Platform.OS === 'web'
            ? ({
                opacity: revealed ? 1 : 0,
                fontFamily: 'system-ui, sans-serif',
                transitionProperty: 'opacity',
                transitionDuration: '250ms',
              } as object)
            : null,
        ]}>
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
            headerTitleStyle: navigationTitleStyle(customFonts),
            headerShadowVisible: false,
            contentStyle: { backgroundColor: theme.bg },
            headerLeft: ({ tintColor, canGoBack }) => <ShellBackButton tintColor={tintColor} canGoBack={canGoBack} />,
          }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
          <Stack.Screen name="join" options={{ title: 'Join a site' }} />
          <Stack.Screen name="reset" options={{ title: 'New password' }} />
        </Stack>
      </View>
    </CustomFontsProvider>
  );
}
