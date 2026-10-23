import { Button, Card, Muted, Screen, SeenRejectNotice, Title } from '@/components/ui';
import { shareInviteText } from '@/data/sharing';
import { formatCodeExpiry } from '@/lib/format';
import { theme } from '@/lib/theme';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

export default function ShareCodeScreen() {
  const params = useLocalSearchParams<{ code?: string; expires?: string; firm?: string; siteName?: string }>();
  const code = first(params.code);
  const firm = first(params.firm);
  const siteName = first(params.siteName);
  const expires = first(params.expires);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const message = code && firm && siteName ? shareInviteText({ company: firm, site: siteName, code }) : '';

  async function onCopy() {
    if (!message) return;
    setNotice('');
    try {
      await Clipboard.setStringAsync(message);
      setCopied(true);
    } catch {
      setNotice('Could not copy that. Read the code out instead.');
    }
  }

  return (
    <Screen>
      <Title>Share code</Title>
      <Muted>Send this to one person at that company. It works once and lasts 7 days.</Muted>
      {code ? (
        <Card>
          <Text style={{ color: theme.text, fontSize: 32, fontWeight: '800', letterSpacing: 1 }}>{code}</Text>
          {firm ? <Muted>{firm}</Muted> : null}
          {siteName ? <Muted>{siteName}</Muted> : null}
          {expires ? <Muted>{formatCodeExpiry(expires)}</Muted> : null}
          {message ? <Text style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>{message}</Text> : null}
        </Card>
      ) : (
        <Muted>Create a share code first.</Muted>
      )}
      {notice ? <SeenRejectNotice message={notice} onDismiss={() => setNotice('')} /> : null}
      {copied ? <Muted>Copied.</Muted> : null}
      <Button label="Copy code" variant="secondary" minHeight={48} onPress={() => void onCopy()} disabled={!message} />
    </Screen>
  );
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}
