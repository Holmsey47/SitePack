import type { Role } from '@/data/types';
import { theme } from '@/lib/theme';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TABS: { href: '/sites' | '/people' | '/requests'; label: string }[] = [
  { href: '/sites', label: 'Sites' },
  { href: '/people', label: 'People' },
  { href: '/requests', label: 'Requests' },
];

export function AppTabs({ role }: { role: Role }) {
  const router = useRouter();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const tabs = role === 'operative' ? TABS.filter((tab) => tab.href === '/sites') : TABS;

  return (
    <View
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: theme.line,
        backgroundColor: theme.bg,
        paddingBottom: Math.max(insets.bottom, 8),
        paddingTop: 8,
      }}>
      {tabs.map((tab) => {
        const active = path === tab.href;
        return (
          <Pressable
            key={tab.href}
            accessibilityRole="button"
            onPress={() => {
              if (!active) router.navigate(tab.href);
            }}
            style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: active ? theme.current : theme.muted, fontWeight: '800' }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
