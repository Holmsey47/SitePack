import { hit, radius, space, textStyle, theme } from '@/lib/theme';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type MenuSheetItem = { label: string; danger?: boolean; onPress: () => void };

/** The same sheet the drawing viewer uses for Download. */
export function MenuSheet({
  open,
  items,
  onClose,
  onPress,
}: {
  open: boolean;
  items: readonly MenuSheetItem[];
  onClose: () => void;
  onPress: (item: MenuSheetItem) => void;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable testID="overflow-backdrop" onPress={onClose} style={styles.scrim}>
        <View style={styles.card}>
          {items.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => onPress(item)}
              style={styles.row}>
              <Text style={[textStyle.bodyStrong, item.danger ? { color: theme.danger } : null]}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable testID="overflow-cancel" accessibilityRole="button" onPress={onClose} style={styles.cancel}>
            <Text style={textStyle.bodyStrong}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

/** Owns open state so a header re-render cannot leave the sheet up. */
export function MenuHost({ items }: { items: readonly MenuSheetItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={() => setOpen(true)} style={styles.trigger}>
        <Text style={textStyle.bodyStrong}>⋯</Text>
      </Pressable>
      <MenuSheet
        open={open}
        items={items}
        onClose={() => setOpen(false)}
        onPress={(item) => {
          setOpen(false);
          item.onPress();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: theme.scrim,
    padding: space.lg,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.line,
    padding: space.lg,
    gap: space.md,
  },
  row: { minHeight: hit.secondary, justifyContent: 'center' },
  cancel: {
    minHeight: hit.secondary,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trigger: {
    width: hit.secondary,
    height: hit.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
