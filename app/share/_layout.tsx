import { theme } from '@/lib/theme';
import { Stack } from 'expo-router';

export default function ShareLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.bg },
        title: 'Open a share',
      }}
    />
  );
}
