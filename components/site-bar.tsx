import {
  SITE_BAR,
  SITE_BAR_BADGE_FONT,
  SITE_BAR_BADGE_SIZE,
  SITE_BAR_MIN_HEIGHT,
  type SiteListKind,
} from '@/data/siteListSeen';
import { theme } from '@/lib/theme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { type Href, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function SiteBar({
  siteId,
  siteName,
  counts,
  onOpen,
}: {
  siteId: string;
  siteName?: string | null;
  counts: Partial<Record<SiteListKind, number>> | null;
  onOpen?: (kind: SiteListKind) => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const caption = siteName?.trim() || 'On this site';

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.line,
        backgroundColor: theme.bg,
        paddingBottom: Math.max(insets.bottom, 8),
      }}>
      <Text
        numberOfLines={1}
        style={{
          color: theme.muted,
          fontSize: 12,
          fontWeight: '800',
          textAlign: 'center',
          paddingTop: 6,
          paddingHorizontal: 12,
        }}>
        {caption}
      </Text>
      <View style={{ flexDirection: 'row' }}>
        {SITE_BAR.map((item) => {
          const count = counts?.[item.kind] ?? 0;
          const showBadge = count > 0;
          return (
            <Pressable
              key={item.kind}
              accessibilityRole="button"
              accessibilityLabel={showBadge ? `${item.label}, ${count} new` : item.label}
              onPress={() => {
                onOpen?.(item.kind);
                router.push(item.path(siteId) as Href);
              }}
              style={{ flex: 1, minHeight: SITE_BAR_MIN_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <View>
                <MaterialIcons name={item.icon} size={22} color={theme.text} />
                {showBadge ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -8,
                      right: -12,
                      minWidth: SITE_BAR_BADGE_SIZE,
                      height: SITE_BAR_BADGE_SIZE,
                      borderRadius: SITE_BAR_BADGE_SIZE / 2,
                      paddingHorizontal: 4,
                      backgroundColor: theme.danger,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Text style={{ color: theme.bg, fontSize: SITE_BAR_BADGE_FONT, fontWeight: '800' }}>
                      {count > 99 ? '99+' : String(count)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ color: theme.text, fontWeight: '800', fontSize: 13 }}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
