import { SITE_BAR, SITE_BAR_MIN_HEIGHT, type SiteListKind } from '@/data/siteListSeen';
import { theme } from '@/lib/theme';
import { type Href, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function SiteBar({
  siteId,
  counts,
}: {
  siteId: string;
  counts: Partial<Record<SiteListKind, number>> | null;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

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
      {SITE_BAR.map((item) => {
        const count = counts?.[item.kind] ?? 0;
        const showBadge = count > 0;
        return (
          <Pressable
            key={item.kind}
            accessibilityRole="button"
            accessibilityLabel={showBadge ? `${item.label}, ${count} new` : item.label}
            onPress={() => router.push(item.path(siteId) as Href)}
            style={{ flex: 1, minHeight: SITE_BAR_MIN_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
            <View>
              <Text style={{ color: theme.muted, fontWeight: '800' }}>{item.label}</Text>
              {showBadge ? (
                <View
                  style={{
                    position: 'absolute',
                    top: -8,
                    right: -18,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    paddingHorizontal: 4,
                    backgroundColor: theme.danger,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Text style={{ color: theme.bg, fontSize: 11, fontWeight: '800' }}>
                    {count > 99 ? '99+' : String(count)}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
