import { SITE_HEADER_HIT, SITE_HEADER_INSET } from '@/data/siteListSeen';
import { theme } from '@/lib/theme';
import { type Href, useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';

export function SitesBackButton() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sites"
      onPress={() => router.dismissTo('/sites')}
      style={{
        minWidth: SITE_HEADER_HIT,
        minHeight: SITE_HEADER_HIT,
        justifyContent: 'center',
        marginLeft: SITE_HEADER_INSET,
        paddingRight: 8,
      }}>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>← Sites</Text>
    </Pressable>
  );
}

export function PeoplePill({ siteId }: { siteId: string }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="People"
      onPress={() => router.push(`/sites/${siteId}/people` as Href)}
      style={{
        minWidth: SITE_HEADER_HIT,
        minHeight: SITE_HEADER_HIT,
        marginRight: SITE_HEADER_INSET,
        paddingHorizontal: 14,
        borderRadius: 999,
        backgroundColor: theme.surfaceAlt,
        borderWidth: 1,
        borderColor: theme.line,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ color: theme.text, fontWeight: '800' }}>People</Text>
    </Pressable>
  );
}
