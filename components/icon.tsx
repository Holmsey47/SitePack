import { fontFamily, iconSize as defaultSize, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';

/** Material Icons names still used by the site bar, mapped to Material Symbols ligatures. */
const LIGATURE: Record<string, string> = {
  'report-problem': 'report',
  'compare-arrows': 'compare_arrows',
  assignment: 'assignment',
  settings: 'settings',
  'chevron-right': 'chevron_right',
  'file-download': 'download',
};

export function Icon({
  name,
  color = theme.text,
  size = defaultSize,
}: {
  name: string;
  color?: string;
  size?: number;
}) {
  const glyph = LIGATURE[name] ?? name;
  return (
    <Text
      accessible={false}
      style={{
        fontFamily: fontFamily.symbols,
        fontSize: size,
        lineHeight: size,
        color,
        width: size,
        height: size,
      }}>
      {glyph}
    </Text>
  );
}
