import { theme } from '@/lib/theme';
import { Stack } from 'expo-router';

export default function ShareLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />
  );
}
