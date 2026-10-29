import { Button, Card, ErrorText, Muted } from '@/components/ui';
import {
  COPY_FAILED_TEXT,
  COPIED_CONFIRMATION_MS,
  SHARE_FAILED_TEXT,
  copyJoinLink,
  joinCodeLink,
  openJoinWhatsApp,
  showShareAction,
  whatsAppJoinMessage,
  whatsAppShareUrl,
} from '@/data/inviteEntry';
import { formatJoinCode } from '@/data/joinCodes';
import { formatCodeExpiry } from '@/lib/format';
import { textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';

type JoinSharePanelProps = {
  code: string;
  siteName: string;
  expiresAt: string;
  uses: number;
  maxUses: number;
};

function shareWasCancelled(error: unknown): boolean {
  return typeof error === 'object' && error != null && 'name' in error && (error as { name?: string }).name === 'AbortError';
}

/** Share card for the code currently on screen. WhatsApp, Share and Copy all use that code. */
export function JoinSharePanel({ code, siteName, expiresAt, uses, maxUses }: JoinSharePanelProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showShare = showShareAction(
    Platform.OS === 'web' ? 'web' : 'native',
    typeof navigator !== 'undefined' && typeof navigator.share === 'function',
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const link = joinCodeLink(code);
  const displayCode = formatJoinCode(code);

  async function onWhatsApp() {
    const shareUrl = whatsAppShareUrl(whatsAppJoinMessage({ site: siteName, code }));
    setError('');
    try {
      await openJoinWhatsApp(shareUrl, Platform.OS === 'web' ? 'web' : 'native', {
        openWindow: (url) => {
          if (typeof window === 'undefined' || typeof window.open !== 'function') return false;
          // noopener makes window.open return null even when the tab opened, which would
          // fall through and replace this page. Clear opener after a normal open instead.
          const opened = window.open(url, '_blank');
          if (!opened) return false;
          opened.opener = null;
          return true;
        },
        openURL: (url) => Linking.openURL(url),
      });
    } catch {
      setCopied(false);
      setError('Could not open WhatsApp.');
    }
  }

  async function onShare() {
    const message = whatsAppJoinMessage({ site: siteName, code });
    setError('');
    try {
      const result = await Share.share({ message });
      if (result?.action === Share.dismissedAction) return;
    } catch (err) {
      if (shareWasCancelled(err)) return;
      setCopied(false);
      setError(SHARE_FAILED_TEXT);
    }
  }

  async function onCopy() {
    setError('');
    try {
      await copyJoinLink(link, {
        setString: (value) => Clipboard.setStringAsync(value),
        writeText:
          typeof navigator !== 'undefined' && navigator.clipboard?.writeText
            ? (value) => navigator.clipboard.writeText(value)
            : undefined,
      });
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_CONFIRMATION_MS);
    } catch {
      setCopied(false);
      setError(COPY_FAILED_TEXT);
    }
  }

  return (
    <Card>
      <Text selectable style={styles.code}>
        {displayCode}
      </Text>
      <Muted>{formatCodeExpiry(expiresAt)}</Muted>
      <Muted>
        {uses} of {maxUses} joined
      </Muted>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share on WhatsApp"
          onPress={() => void onWhatsApp()}
          style={({ pressed }) => [styles.whatsApp, pressed && styles.pressed]}>
          <Text style={styles.whatsAppText}>Share on WhatsApp</Text>
        </Pressable>
        {showShare ? (
          <Button label="Share…" variant="secondary" minHeight={48} onPress={() => void onShare()} />
        ) : null}
        <Button label="Copy link" variant="secondary" minHeight={48} onPress={() => void onCopy()} />
      </View>
      {copied ? (
        <Text accessibilityLiveRegion="polite" style={styles.copied}>
          Copied
        </Text>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

const styles = StyleSheet.create({
  code: {
    ...textStyle.display,
    letterSpacing: 1,
  },
  actions: { gap: 8, alignSelf: 'stretch' },
  whatsApp: {
    minHeight: 56,
    width: '100%',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    paddingHorizontal: 18,
  },
  whatsAppText: { color: '#06210F', fontSize: 17, fontWeight: '800' },
  pressed: { opacity: 0.85 },
  copied: { ...textStyle.metaStrong, color: theme.sent },
});
