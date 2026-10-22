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
      <Stack.Screen name="home" options={{ headerShown: false }} />
      <Stack.Screen name="create-site" options={{ title: 'Create site' }} />
      <Stack.Screen name="sites/index" options={{ title: 'Sites' }} />
      <Stack.Screen name="sites/[siteId]/index" options={{ title: 'Site pack' }} />
      <Stack.Screen name="sites/[siteId]/folder/[folder]" options={{ title: 'Folder' }} />
      <Stack.Screen name="sites/[siteId]/variations/index" options={{ title: 'Variations' }} />
      <Stack.Screen name="sites/[siteId]/variations/new" options={{ title: 'New variation' }} />
      <Stack.Screen name="sites/[siteId]/variations/[variationId]" options={{ title: 'Variation' }} />
      <Stack.Screen name="sites/[siteId]/request" options={{ title: 'Request a drawing' }} />
      <Stack.Screen name="sites/[siteId]/upload" options={{ title: 'Upload' }} />
      <Stack.Screen name="sites/[siteId]/drawing/[drawingId]" options={{ title: 'Drawing' }} />
      <Stack.Screen name="sites/[siteId]/assignments" options={{ title: 'Assigned people' }} />
      <Stack.Screen name="sites/[siteId]/invite-code" options={{ title: 'Invite to site' }} />
      <Stack.Screen name="sites/[siteId]/joined" options={{ title: 'Who joined' }} />
      <Stack.Screen name="requests/index" options={{ title: 'Drawing requests' }} />
      <Stack.Screen name="requests/[requestId]" options={{ title: 'Request' }} />
      <Stack.Screen name="invite" options={{ title: 'Invite' }} />
      <Stack.Screen name="people" options={{ title: 'People' }} />
      <Stack.Screen name="groups/index" options={{ title: 'Groups' }} />
      <Stack.Screen name="groups/[groupId]" options={{ title: 'Group' }} />
    </Stack>
  );
}
