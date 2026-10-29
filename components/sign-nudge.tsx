import { Icon } from '@/components/icon';
import { Card } from '@/components/ui';
import { hit, space, textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { View } from 'react-native';

/** A warning on Home. It does not block the rest of the screen. */
export function SignNudgeCard({
  title,
  detail,
  onPress,
}: {
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Card onPress={onPress}>
      <View
        testID="sign-nudge"
        style={{ minHeight: hit.min, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View
          style={{
            width: 4,
            alignSelf: 'stretch',
            borderRadius: 2,
            backgroundColor: theme.current,
          }}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={textStyle.bodyStrong}>{title}</Text>
          <Text style={textStyle.meta}>{detail}</Text>
        </View>
        <Icon name="chevron_right" color={theme.muted} />
      </View>
    </Card>
  );
}
