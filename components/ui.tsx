import { theme } from '@/lib/theme';
import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({
  children,
  scroll = true,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
}) {
  const edges = footer ? (['top'] as const) : (['top', 'bottom'] as const);
  const body = scroll ? (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    children
  );
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      {body}
      {footer}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  minHeight,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  /** Glove target. Defaults to the shared thumb height. */
  minHeight?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        minHeight != null && { minHeight: Math.max(minHeight, variant === 'primary' ? 56 : 48) },
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        (disabled || loading) && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? theme.currentInk : theme.text} />
      ) : (
        <Text
          numberOfLines={3}
          ellipsizeMode="tail"
          style={[
            styles.btnText,
            Platform.OS === 'web' ? ({ overflowWrap: 'anywhere' } as object) : null,
            variant === 'primary' && { color: theme.currentInk },
            variant === 'ghost' && { color: theme.current },
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize = 'none',
  multiline,
  keyboardType,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  maxLength?: number;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        multiline={multiline}
        keyboardType={keyboardType}
        maxLength={maxLength}
        style={[styles.input, multiline && { minHeight: 120, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{title}</Text>
      {action}
    </View>
  );
}

export function RevBadge({ revision, current }: { revision: string; current: boolean }) {
  return (
    <View style={[styles.rev, current ? styles.revCurrent : styles.revOld]}>
      <Text style={[styles.revText, current ? styles.revTextCurrent : styles.revTextOld]}>
        Rev {revision}
      </Text>
    </View>
  );
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  const body = <View style={styles.card}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>
      {body}
    </Pressable>
  );
}

const NO_LOGIN = "No login: can't see drawings";

/** Words carry the meaning. The amber fill is only a second cue. */
export function NoLoginBadge() {
  return (
    <View style={styles.noLogin} accessibilityRole="text">
      <Text style={styles.noLoginText}>{NO_LOGIN}</Text>
    </View>
  );
}

/** Current sheet the signed-in person has not confirmed. A label, not a control. */
export function NewRevBadge({ sheet, revision }: { sheet: string; revision: string }) {
  const label = `New: ${sheet} rev ${revision}`;
  return (
    <View style={styles.newRev} accessibilityRole="text" accessibilityLabel={label}>
      <Text style={styles.newRevText}>{label}</Text>
    </View>
  );
}

/** A refused queue item. Open jumps to the current sheet. Dismiss hides an hours notice on this phone. */
export function SeenRejectNotice({
  message,
  onPress,
  onDismiss,
}: {
  message: string;
  onPress?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={message}
      onPress={onPress}
      style={({ pressed }) => [styles.seenReject, pressed && styles.btnPressed]}>
      <Text style={styles.seenRejectText}>{message}</Text>
      {onDismiss ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} style={styles.dismiss}>
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
      ) : (
        <Text style={styles.seenRejectOpen}>Open</Text>
      )}
    </Pressable>
  );
}

/** Full-width row, at least 48dp. Used for the team line and the collapsed new-drawings row. */
export function GlanceRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.glanceRow, pressed && styles.btnPressed]}>
      <Text style={styles.glanceRowText}>{label}</Text>
    </Pressable>
  );
}

/** Owner or contracts manager count. Tap opens who has and has not seen it. */
export function SeenCountChip({
  seen,
  total,
  onPress,
}: {
  seen: number;
  total: number;
  onPress: () => void;
}) {
  const label = `${seen} of ${total} seen`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.seenChip, pressed && styles.btnPressed]}>
      <Text style={styles.seenChipText}>{label}</Text>
    </Pressable>
  );
}

/** The copy on this phone is out of date. A label, not a control. */
export function OutOfDateBadge() {
  return (
    <View
      pointerEvents="none"
      style={styles.outOfDate}
      accessibilityRole="text"
      accessibilityLabel="Out of date">
      <Text style={styles.outOfDateText}>Out of date</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

/** Glove-sized choice. At least 48dp, cream on dark or ink on gold. */
export function ChoiceChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipSelected : styles.chipIdle,
        pressed && styles.btnPressed,
      ]}>
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : styles.chipTextIdle]}>{label}</Text>
    </Pressable>
  );
}

export function HeaderActions(props: PressableProps & { label: string }) {
  const { label, ...rest } = props;
  return (
    <Pressable {...rest} hitSlop={12}>
      <Text style={styles.headerLink}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 20, gap: 16, paddingBottom: 40 },
  title: { color: theme.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: theme.muted, fontSize: 16, lineHeight: 22 },
  muted: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  btn: {
    minHeight: theme.thumb,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  btnPrimary: { backgroundColor: theme.current, minHeight: 56 },
  btnSecondary: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.line },
  btnGhost: { backgroundColor: 'transparent' },
  btnDanger: { backgroundColor: theme.danger },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { transform: [{ scale: 0.99 }] },
  btnText: { color: theme.text, fontSize: 17, fontWeight: '700', textAlign: 'center', width: '100%' },
  fieldLabel: { color: theme.muted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    backgroundColor: theme.surface,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 12,
    color: theme.text,
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: theme.thumb,
  },
  empty: { gap: 12, paddingVertical: 28 },
  emptyText: { color: theme.text, fontSize: 18, fontWeight: '600', lineHeight: 24 },
  rev: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, alignSelf: 'flex-start' },
  revCurrent: { backgroundColor: theme.current },
  revOld: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.line },
  revText: { fontSize: 18, fontWeight: '800' },
  revTextCurrent: { color: theme.currentInk },
  revTextOld: { color: theme.superseded },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: theme.line,
  },
  error: { color: theme.danger, fontSize: 15, lineHeight: 20 },
  headerLink: { color: theme.current, fontSize: 16, fontWeight: '700' },
  chip: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipIdle: { backgroundColor: theme.surface, borderColor: theme.text },
  chipSelected: { backgroundColor: theme.current, borderColor: theme.current },
  chipText: { fontSize: 16, fontWeight: '800' },
  chipTextIdle: { color: theme.text },
  chipTextSelected: { color: theme.currentInk },
  noLogin: {
    alignSelf: 'flex-start',
    backgroundColor: theme.current,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  noLoginText: { color: theme.currentInk, fontSize: 14, fontWeight: '800' },
  outOfDate: {
    alignSelf: 'flex-start',
    backgroundColor: theme.open,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  outOfDateText: { color: theme.currentInk, fontSize: 14, fontWeight: '800' },
  newRev: {
    alignSelf: 'flex-start',
    backgroundColor: theme.current,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  newRevText: { color: theme.currentInk, fontSize: 15, fontWeight: '800' },
  seenReject: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 2,
    borderColor: theme.open,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  seenRejectText: { color: theme.text, fontSize: 17, fontWeight: '800', lineHeight: 24, flex: 1 },
  seenRejectOpen: { color: theme.current, fontSize: 17, fontWeight: '800' },
  dismiss: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  dismissText: { color: theme.current, fontSize: 17, fontWeight: '800' },
  glanceRow: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.current,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  glanceRowText: { color: theme.text, fontSize: 17, fontWeight: '800', lineHeight: 22 },
  seenChip: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.current,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  seenChipText: { color: theme.text, fontSize: 16, fontWeight: '800', textAlign: 'center' },
});
