import { theme } from '@/lib/theme';
import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.bg },
      }}>
      <Stack.Screen name="home" options={{ title: 'Your sites' }} />
      <Stack.Screen name="sites/index" options={{ title: 'Pulse' }} />
      <Stack.Screen name="sites/[siteId]/index" options={{ title: 'Site pack' }} />
      <Stack.Screen name="sites/[siteId]/folder/[folder]" options={{ title: 'Folder' }} />
      <Stack.Screen name="sites/[siteId]/request" options={{ title: 'Request a drawing' }} />
      <Stack.Screen name="sites/[siteId]/upload" options={{ title: 'Upload revision' }} />
      <Stack.Screen name="sites/[siteId]/drawing/[drawingId]" options={{ title: 'Drawing' }} />
      <Stack.Screen name="sites/[siteId]/assignments" options={{ title: 'Assigned people' }} />
      <Stack.Screen name="requests/index" options={{ title: 'Drawing requests' }} />
      <Stack.Screen name="requests/[requestId]" options={{ title: 'Request' }} />
      <Stack.Screen name="invite" options={{ title: 'Invite' }} />
    </Stack>
  );
}
