import { Icon } from '@/components/icon';
import type { Role } from '@/data/types';
import { hit, textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TABS: { href: '/sites' | '/people' | '/requests'; label: string; icon: string }[] = [
  { href: '/sites', label: 'Sites', icon: 'apartment' },
  { href: '/people', label: 'People', icon: 'group' },
  { href: '/requests', label: 'Requests', icon: 'assignment' },
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
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) router.navigate(tab.href);
            }}
            style={{
              flex: 1,
              minHeight: hit.secondary,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              borderTopWidth: 2,
              borderTopColor: active ? theme.text : 'transparent',
            }}>
            <Icon name={tab.icon} color={active ? theme.text : theme.muted} />
            <Text style={[textStyle.metaStrong, { color: active ? theme.text : theme.muted }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
