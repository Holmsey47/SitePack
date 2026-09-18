import { theme } from '@/lib/theme';
import { ReactNode } from 'react';
import {
  ActivityIndicator,
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
}: {
  children: ReactNode;
  scroll?: boolean;
}) {
  if (!scroll) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {children}
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
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
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
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
          style={[
            styles.btnText,
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
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address';
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
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>
      {body}
    </Pressable>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
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
    paddingHorizontal: 18,
  },
  btnPrimary: { backgroundColor: theme.current },
  btnSecondary: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.line },
  btnGhost: { backgroundColor: 'transparent' },
  btnDanger: { backgroundColor: theme.danger },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { transform: [{ scale: 0.99 }] },
  btnText: { color: theme.text, fontSize: 17, fontWeight: '700' },
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
});
