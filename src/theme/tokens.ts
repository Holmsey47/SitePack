/**
 * SitePack visual tokens. Colours, type, spacing, radius, icons and logo slots
 * live here so a future logo or accent is a one-file change.
 */
import type { TextStyle } from 'react-native';

export const theme = {
  bg: '#121820',
  surface: '#1C2530',
  surfaceAlt: '#243040',
  line: '#2E3A48',
  text: '#F4F1EA',
  muted: '#B0B8C1',
  current: '#E8B84A',
  /** Dark ink on amber, danger and done fills. Spec body text is #121820. */
  currentInk: '#121820',
  superseded: '#6B7380',
  /** Cool grey for an archive folder name. Readable on the card, not the cream of a live folder. */
  archive: '#B4BEC7',
  open: '#D96B4F',
  sent: '#6FAE8F',
  done: '#6FAE8F',
  closed: '#8A93A0',
  danger: '#E07070',
  /** Solid scrim behind a confirm. Not a blur or a glass panel. */
  scrim: '#070B10',
  /** About 45% black behind a menu sheet, so the page stays visible. */
  menuScrim: 'rgba(0, 0, 0, 0.45)',
  thumb: 48,
  /** Online status dot. Done colour, not amber. */
  online: '#6FAE8F',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  control: 12,
  card: 12,
  pill: 999,
} as const;

export const hit = {
  primary: 56,
  secondary: 48,
  min: 48,
} as const;

/** 28 page title, 22 section, 17 body, 15 meta, 13 uppercase labels only. */
export const typeScale = {
  display: 28,
  title: 22,
  body: 17,
  meta: 15,
  label: 13,
} as const;

export const iconSize = 24;

export const logo = {
  welcome: 64,
  splash: 64,
  wordmark: 28,
  company: 32,
} as const;

export const fontFamily = {
  regular: 'Inter_400',
  semibold: 'Inter_600',
  bold: 'Inter_700',
  extraBold: 'Inter_800',
  symbols: 'MaterialSymbolsRounded',
} as const;

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const textStyle: {
  display: TextStyle;
  title: TextStyle;
  body: TextStyle;
  bodyStrong: TextStyle;
  meta: TextStyle;
  metaStrong: TextStyle;
  label: TextStyle;
  tabular: TextStyle;
} = {
  display: {
    color: theme.text,
    fontSize: typeScale.display,
    lineHeight: 34,
    fontFamily: fontFamily.extraBold,
    letterSpacing: -0.4,
  },
  title: {
    color: theme.text,
    fontSize: typeScale.title,
    lineHeight: 28,
    fontFamily: fontFamily.bold,
  },
  body: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 24,
    fontFamily: fontFamily.regular,
  },
  bodyStrong: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 24,
    fontFamily: fontFamily.bold,
  },
  meta: {
    color: theme.muted,
    fontSize: typeScale.meta,
    lineHeight: 20,
    fontFamily: fontFamily.regular,
    ...tabular,
  },
  metaStrong: {
    color: theme.text,
    fontSize: typeScale.meta,
    lineHeight: 20,
    fontFamily: fontFamily.semibold,
    ...tabular,
  },
  label: {
    color: theme.muted,
    fontSize: typeScale.label,
    lineHeight: 18,
    fontFamily: fontFamily.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tabular,
};
