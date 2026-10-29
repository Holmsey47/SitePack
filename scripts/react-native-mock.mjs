import { createElement } from 'react';

export const Platform = {
  OS: 'ios',
  select(specifics) {
    return specifics[this.OS] ?? specifics.default;
  },
};

export function setPlatformOS(os) {
  Platform.OS = os;
}

export const StyleSheet = {
  create(styles) {
    return styles;
  },
  flatten(style) {
    if (style == null) return {};
    if (Array.isArray(style)) return Object.assign({}, ...style.map((item) => StyleSheet.flatten(item)));
    return style;
  },
};

function host(type) {
  return function Host(props) {
    return createElement(type, props);
  };
}

export const View = host('View');
export const Text = host('Text');
export const TextInput = host('TextInput');
export const Pressable = host('Pressable');
export const ActivityIndicator = host('ActivityIndicator');
