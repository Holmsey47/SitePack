import { loadSheetHtml, SHEET_OPEN_ERROR } from '@/lib/sheetDocument';
import { theme } from '@/lib/theme';
import { useEffect, useState, createElement } from 'react';
import { ActivityIndicator, View } from 'react-native';

export function DrawingFrame({ uri, onError }: { uri: string; onError?: (message: string) => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    void (async () => {
      try {
        const next = await loadSheetHtml(uri);
        if (!cancelled) setHtml(next);
      } catch {
        if (!cancelled) {
          setFailed(true);
          onError?.(SHEET_OPEN_ERROR);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError, uri]);

  if (failed) return null;

  if (!html) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.current} />
      </View>
    );
  }

  return createElement('iframe', {
    title: 'drawing',
    srcDoc: html,
    style: { flex: 1, width: '100%', height: '100%', border: 0, background: theme.bg },
  });
}
