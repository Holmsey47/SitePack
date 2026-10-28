import { createContext, useContext, type ReactNode } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { fontFamily, textStyle, theme } from './tokens';

const CustomFontsContext = createContext(true);

export function CustomFontsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <CustomFontsContext.Provider value={enabled}>{children}</CustomFontsContext.Provider>;
}

export function useCustomFonts() {
  return useContext(CustomFontsContext);
}

const defaultType: TextStyle = {
  fontFamily: fontFamily.regular,
  fontSize: textStyle.body.fontSize,
  color: theme.text,
};

/** Weight to ask of the system font when the matching Inter file did not load. */
const faceWeight: Record<string, TextStyle['fontWeight']> = {
  [fontFamily.regular]: '400',
  [fontFamily.semibold]: '600',
  [fontFamily.bold]: '700',
  [fontFamily.extraBold]: '800',
};

function resolveStyle(style: StyleProp<TextStyle> | undefined, customFonts: boolean): StyleProp<TextStyle> {
  if (!customFonts) {
    const flat = StyleSheet.flatten(style);
    const family = typeof flat?.fontFamily === 'string' ? flat.fontFamily : undefined;
    if (!family) return style;
    const next: TextStyle = { ...flat };
    const weight = faceWeight[family] ?? next.fontWeight;
    delete next.fontFamily;
    if (weight == null) delete next.fontWeight;
    else next.fontWeight = weight;
    return next;
  }
  if (style == null) return defaultType;
  const flat = StyleSheet.flatten(style);
  if (flat && typeof flat.fontFamily === 'string' && flat.fontFamily.startsWith('Inter_') && flat.fontWeight != null) {
    const next: TextStyle = { ...flat };
    delete next.fontWeight;
    return next;
  }
  return style;
}

/** Body text. Unstyled text uses Inter Regular. A failed font load keeps the system face. */
export function Text({ style, ...props }: TextProps) {
  const customFonts = useCustomFonts();
  return <RNText {...props} style={resolveStyle(style, customFonts)} />;
}

/** Field text. Same face rules as Text, in place of TextInput.defaultProps. */
export function TextInput({ style, ...props }: TextInputProps) {
  const customFonts = useCustomFonts();
  return <RNTextInput {...props} style={resolveStyle(style, customFonts)} />;
}

export function navigationTitleStyle(customFonts: boolean) {
  if (customFonts) {
    return { fontFamily: fontFamily.bold, fontSize: textStyle.title.fontSize };
  }
  return { fontWeight: '700' as const, fontSize: textStyle.title.fontSize };
}
