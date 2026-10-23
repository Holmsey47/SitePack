import { SeenRejectNotice } from '@/components/ui';
import { questionsLabel, readAndSignLabel, talkTypeLabel } from '@/data/talks';
import type { TalkKind } from '@/lib/talkMeaning';
import type { TalkNotice } from '@/lib/talkQueue';
import { theme } from '@/lib/theme';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';

function openRow(event: GestureResponderEvent, onPress: () => void) {
  if (typeof event.stopPropagation === 'function') event.stopPropagation();
  onPress();
}

/** The document type. At least 48dp, a label rather than a button. */
export function TalkTypeLabel({ kind }: { kind: TalkKind }) {
  const label = talkTypeLabel(kind);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        minHeight: 48,
        justifyContent: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: theme.current,
      }}>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>{label}</Text>
    </View>
  );
}

/** One row on Home and the site card. Not a stack of pills. */
export function TalkReadRow({ count, onPress }: { count: number; onPress: () => void }) {
  if (count < 1) return null;
  const label = readAndSignLabel(count);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={(event) => openRow(event, onPress)}
      style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

export function TalkQuestionRow({ count, onPress }: { count: number; onPress: () => void }) {
  if (count < 1) return null;
  const label = questionsLabel(count);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={(event) => openRow(event, onPress)}
      style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

export function TalkNoticeList({
  notices,
  onDismiss,
  onRetry,
}: {
  notices: TalkNotice[];
  onDismiss: (notice: TalkNotice) => void;
  onRetry: (notice: TalkNotice) => void;
}) {
  if (notices.length < 1) return null;
  return (
    <View style={{ gap: 8 }}>
      {notices.map((notice) => (
        <View key={notice.id} style={{ gap: 8 }}>
          <SeenRejectNotice message={notice.message} onDismiss={() => onDismiss(notice)} />
          {notice.retryLocalId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try again"
              onPress={() => onRetry(notice)}
              style={{ minHeight: 48, justifyContent: 'center' }}>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

