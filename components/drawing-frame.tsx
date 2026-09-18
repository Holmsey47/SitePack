import { theme } from '@/lib/theme';
import { WebView } from 'react-native-webview';

export function DrawingFrame({ uri }: { uri: string }) {
  return (
    <WebView
      source={{ uri }}
      style={{ flex: 1, backgroundColor: theme.bg }}
      allowFileAccess
      originWhitelist={['*']}
    />
  );
}
