import { theme } from '@/lib/theme';
import { Stack } from 'expo-router';

export default function ResetLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />;
}
