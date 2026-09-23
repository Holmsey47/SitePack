import { bytesToBase64 } from '@/data/base64';
import { sheetViewHtml } from '@/lib/sheetHtml';
import { theme } from '@/lib/theme';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';

const LIBRARY_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const OPEN_ERROR = 'Could not open the sheet.';

async function cachedScript(name: string, url: string): Promise<string> {
  const folder = new Directory(Paths.cache, 'sitepack-viewer');
  folder.create({ intermediates: true, idempotent: true });
  const file = new File(folder, name);
  if (!file.exists) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(OPEN_ERROR);
    file.create();
    file.write(await response.text());
  }
  return file.base64();
}

async function pdfBase64(uri: string): Promise<string> {
  if (!uri.startsWith('http')) return new File(uri).base64();
  const response = await fetch(uri);
  if (!response.ok) throw new Error(OPEN_ERROR);
  return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
}

export function DrawingFrame({ uri, onError }: { uri: string; onError?: (message: string) => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    void (async () => {
      try {
        const [pdf, library, worker] = await Promise.all([
          pdfBase64(uri),
          cachedScript('pdf.min.js', LIBRARY_URL),
          cachedScript('pdf.worker.min.js', WORKER_URL),
        ]);
        if (!cancelled) setHtml(sheetViewHtml(pdf, library, worker));
      } catch {
        if (!cancelled) {
          setFailed(true);
          onError?.(OPEN_ERROR);
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
