import { parsePdfMessage } from '@/lib/pdfViewHtml';
import { theme } from '@/lib/theme';
import { useRef } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

function allowsViewerUrl(url: string): boolean {
  return !/supabase\.co/i.test(url);
}

export function PdfFrame({
  html,
  onPage,
  onError,
}: {
  html: string;
  onPage: (page: number, total: number) => void;
  onError: () => void;
}) {
  const failed = useRef(false);

  function handleMessage(event: WebViewMessageEvent) {
    const parsed = parsePdfMessage(event.nativeEvent.data);
    if (!parsed || failed.current) return;
    if ('error' in parsed) {
      failed.current = true;
      onError();
      return;
    }
    onPage(parsed.page, parsed.total);
  }

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html, baseUrl: 'about:blank' }}
      style={{ flex: 1, backgroundColor: theme.bg }}
      onMessage={handleMessage}
      onError={() => {
        if (failed.current) return;
        failed.current = true;
        onError();
      }}
      onShouldStartLoadWithRequest={(request) => allowsViewerUrl(request.url)}
      setSupportMultipleWindows={false}
      scalesPageToFit={false}
      setBuiltInZoomControls={false}
      setDisplayZoomControls={false}
      javaScriptEnabled
    />
  );
}
