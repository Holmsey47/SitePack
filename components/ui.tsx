import { Icon } from '@/components/icon';
import { fontFamily, hit, iconSize, logo, radius, space, textStyle, theme, typeScale } from '@/lib/theme';
import { ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
  contentPaddingBottom,
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  /** Extra space at the end of a scrolling page, so a footer bar does not cover the last row. */
  contentPaddingBottom?: number;
}) {
  const edges = footer ? (['top'] as const) : (['top', 'bottom'] as const);
  const body = scroll ? (
    <ScrollView
      style={footer ? { flex: 1 } : undefined}
      contentContainerStyle={[styles.scroll, contentPaddingBottom != null ? { paddingBottom: contentPaddingBottom } : null]}
      keyboardShouldPersistTaps="handled">
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

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
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
  const quiet = Boolean(disabled) && !loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        minHeight != null && { minHeight: Math.max(minHeight, variant === 'primary' ? hit.primary : hit.secondary) },
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        quiet && styles.btnQuiet,
        pressed && !disabled && styles.btnPressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? theme.currentInk : theme.text} />
      ) : (
        <Text
          numberOfLines={3}
          ellipsizeMode="tail"
          style={[
            styles.btnText,
            Platform.OS === 'web' ? ({ overflowWrap: 'anywhere' } as object) : null,
            !quiet && (variant === 'primary' || variant === 'danger') ? { color: theme.currentInk } : null,
            !quiet && variant === 'ghost' ? { color: theme.muted } : null,
            quiet && { color: theme.muted },
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
    <View style={{ gap: space.sm }}>
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

export function EmptyState({
  title,
  action,
  icon = 'inbox',
}: {
  title: string;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <View style={styles.empty}>
      <Icon name={icon} color={theme.muted} size={iconSize} />
      <Text style={styles.emptyText}>{title}</Text>
      {action}
    </View>
  );
}

export function RevBadge({ revision, current }: { revision: string; current: boolean }) {
  return (
    <View style={[styles.rev, current ? styles.revCurrent : styles.revOld]}>
      <Text style={[styles.revText, current ? styles.revTextCurrent : styles.revTextOld]}>Rev {revision}</Text>
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

/** Words carry the meaning. The fill is only a second cue, and it is not amber. */
export function NoLoginBadge() {
  return (
    <View style={styles.noLogin} accessibilityRole="text">
      <Text style={styles.noLoginText}>{NO_LOGIN}</Text>
    </View>
  );
}

/** Current sheet the signed-in person has not confirmed. A rev badge, not a control. */
export function NewRevBadge({ sheet, revision }: { sheet: string; revision: string }) {
  const label = `New: ${sheet} rev ${revision}`;
  return (
    <View style={styles.newRev} accessibilityRole="text" accessibilityLabel={label}>
      <Text style={styles.newRevText}>{label}</Text>
    </View>
  );
}

/** A queued seen tap the server refused. Tap opens the current sheet. */
export function SeenRejectNotice({ message, onPress }: { message: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={message}
      onPress={onPress}
      style={({ pressed }) => [styles.seenReject, pressed && styles.btnPressed]}>
      <Text style={styles.seenRejectText}>{message}</Text>
      <Text style={styles.seenRejectOpen}>Open</Text>
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
    <View pointerEvents="none" style={styles.outOfDate} accessibilityRole="text" accessibilityLabel="Out of date">
      <Text style={styles.outOfDateText}>Out of date</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

/** Glove-sized choice. Selected is filled and ticked, so colour is not the only cue. */
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
      {selected ? <Icon name="check" color={theme.bg} size={18} /> : null}
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : styles.chipTextIdle]}>{label}</Text>
    </Pressable>
  );
}

export function FilterBar({
  chips,
  level,
}: {
  chips: { key: string; label: string; selected: boolean; onPress: () => void }[];
  level?: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void };
}) {
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.filterRow}>
        {chips.map((chip) => (
          <ChoiceChip key={chip.key} label={chip.label} selected={chip.selected} onPress={chip.onPress} />
        ))}
      </View>
      {level ? <LevelMenu value={level.value} options={level.options} onChange={level.onChange} /> : null}
    </View>
  );
}

export function LevelMenu({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value)?.label ?? 'All levels';
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Level, ${current}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.levelBtn, pressed && styles.btnPressed]}>
        <Text style={styles.levelLabel}>Level</Text>
        <Text style={styles.levelValue} numberOfLines={1}>
          {current}
        </Text>
        <Icon name="expand_more" color={theme.text} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalScrim} onPress={() => setOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Level</Text>
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={styles.modalRow}>
                  {selected ? <Icon name="check" color={theme.text} /> : <View style={{ width: 24 }} />}
                  <Text style={styles.modalRowText}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export function OverflowMenu({
  items,
  label = 'More',
}: {
  label?: string;
  items: { label: string; danger?: boolean; onPress: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={styles.iconHit}>
        <Icon name="more_horiz" color={theme.text} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalScrim} onPress={() => setOpen(false)}>
          <View style={styles.modalCard}>
            {items.map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                onPress={() => {
                  setOpen(false);
                  item.onPress();
                }}
                style={styles.modalRow}>
                <Text style={[styles.modalRowText, item.danger && { color: theme.danger }]}>{item.label}</Text>
              </Pressable>
            ))}
            <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** Placeholder until a real SitePack mark exists. */
export function LogoSlot({ size }: { size: number }) {
  return (
    <View
      accessibilityLabel="SitePack"
      style={{
        width: size,
        height: size,
        borderRadius: radius.control,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.line,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text
        style={{
          color: theme.text,
          fontFamily: fontFamily.extraBold,
          fontSize: size >= logo.welcome ? typeScale.title : typeScale.label,
        }}>
        SP
      </Text>
    </View>
  );
}

export function Wordmark() {
  return <Text style={styles.wordmark}>SitePack</Text>;
}

export function HeaderActions(props: PressableProps & { label: string }) {
  const { label, ...rest } = props;
  return (
    <Pressable {...rest} hitSlop={12} style={{ minHeight: hit.min, justifyContent: 'center' }}>
      <Text style={styles.headerLink}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: space.xxl + space.sm },
  title: textStyle.display,
  subtitle: { ...textStyle.body, color: theme.muted },
  muted: textStyle.meta,
  sectionLabel: { ...textStyle.label, marginTop: space.md },
  btn: {
    minHeight: hit.secondary,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: 18,
    paddingVertical: space.md,
  },
  btnPrimary: { backgroundColor: theme.current, minHeight: hit.primary },
  /** Darker than a surface button, muted text. Reads as off, and stays above 4.5:1. */
  btnQuiet: { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.line },
  btnSecondary: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, minHeight: hit.secondary },
  btnGhost: { backgroundColor: 'transparent' },
  btnDanger: { backgroundColor: theme.danger, minHeight: hit.secondary },
  btnPressed: { transform: [{ scale: 0.99 }] },
  btnText: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 22,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  fieldLabel: textStyle.metaStrong,
  input: {
    backgroundColor: theme.surface,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: radius.control,
    color: theme.text,
    fontFamily: fontFamily.regular,
    fontSize: typeScale.body,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: hit.secondary,
  },
  empty: { gap: space.md, paddingVertical: space.xl, alignItems: 'flex-start' },
  emptyText: textStyle.bodyStrong,
  rev: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.control, alignSelf: 'flex-start' },
  revCurrent: { backgroundColor: theme.current },
  revOld: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line },
  revText: { fontSize: typeScale.body, fontFamily: fontFamily.extraBold, fontWeight: '800', ...textStyle.tabular },
  revTextCurrent: { color: theme.currentInk },
  revTextOld: { color: theme.muted },
  card: {
    backgroundColor: theme.surface,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.sm,
    borderWidth: 1,
    borderColor: theme.line,
  },
  error: { color: theme.danger, fontSize: typeScale.meta, lineHeight: 20, fontFamily: fontFamily.regular },
  headerLink: { ...textStyle.bodyStrong, color: theme.text },
  chip: {
    minHeight: hit.secondary,
    minWidth: hit.secondary,
    maxWidth: '100%',
    flexShrink: 0,
    paddingHorizontal: 14,
    borderRadius: radius.control,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
  },
  chipIdle: { backgroundColor: 'transparent', borderColor: theme.line },
  chipSelected: { backgroundColor: theme.text, borderColor: theme.text },
  chipText: { flexShrink: 1, fontSize: typeScale.body, fontFamily: fontFamily.bold, fontWeight: '700' },
  chipTextIdle: { color: theme.text },
  chipTextSelected: { color: theme.bg },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.sm },
  levelBtn: {
    minHeight: hit.secondary,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  levelLabel: textStyle.metaStrong,
  levelValue: { ...textStyle.bodyStrong, flex: 1, flexShrink: 1 },
  noLogin: {
    alignSelf: 'flex-start',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: space.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  noLoginText: { ...textStyle.metaStrong, color: theme.text },
  outOfDate: {
    alignSelf: 'flex-start',
    backgroundColor: theme.open,
    borderRadius: space.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  outOfDateText: { color: theme.currentInk, fontSize: typeScale.meta, fontFamily: fontFamily.extraBold, fontWeight: '800' },
  newRev: {
    alignSelf: 'flex-start',
    backgroundColor: theme.current,
    borderRadius: space.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  newRevText: { color: theme.currentInk, fontSize: typeScale.meta, fontFamily: fontFamily.extraBold, fontWeight: '800' },
  seenReject: {
    minHeight: hit.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.control,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  seenRejectText: { ...textStyle.bodyStrong, flex: 1 },
  seenRejectOpen: textStyle.bodyStrong,
  glanceRow: {
    minHeight: hit.secondary,
    minWidth: hit.secondary,
    paddingHorizontal: 14,
    paddingVertical: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  glanceRowText: textStyle.bodyStrong,
  seenChip: {
    minHeight: hit.secondary,
    minWidth: hit.secondary,
    paddingHorizontal: 14,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  seenChipText: { ...textStyle.bodyStrong, textAlign: 'center', ...textStyle.tabular },
  iconHit: { width: hit.secondary, height: hit.secondary, alignItems: 'center', justifyContent: 'center' },
  modalScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: theme.scrim, padding: space.lg },
  modalCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.line,
    padding: space.lg,
    gap: space.md,
  },
  modalTitle: textStyle.title,
  modalRow: { minHeight: hit.secondary, flexDirection: 'row', alignItems: 'center', gap: space.md },
  modalRowText: textStyle.bodyStrong,
  wordmark: {
    color: theme.text,
    fontFamily: fontFamily.extraBold,
    fontWeight: '800',
    fontSize: logo.wordmark,
    lineHeight: 32,
    letterSpacing: -0.4,
  },
});
