import { loadSheetHtml, SHEET_OPEN_ERROR } from '@/lib/sheetDocument';
import { theme } from '@/lib/theme';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';

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

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={{ flex: 1, backgroundColor: theme.bg }}
      setSupportMultipleWindows={false}
    />
  );
}
