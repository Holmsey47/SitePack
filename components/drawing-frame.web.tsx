import { createElement } from 'react';

export function DrawingFrame({ uri }: { uri: string }) {
  return createElement('iframe', {
    title: 'drawing',
    src: uri,
    style: { flex: 1, width: '100%', height: '100%', border: 0, background: '#111' },
  });
}
