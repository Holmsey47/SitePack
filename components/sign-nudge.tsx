import { Card } from '@/components/ui';
import { hit, textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { View } from 'react-native';

/** A warning on Home. It does not block the rest of the screen. */
export function SignNudgeCard({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Card onPress={onPress}>
      <View testID="sign-nudge" style={{ minHeight: hit.min, justifyContent: 'center' }}>
        <Text style={{ ...textStyle.bodyStrong, color: theme.text }}>{label}</Text>
      </View>
    </Card>
  );
}
