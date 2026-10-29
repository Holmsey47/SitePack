import { PdfFrame } from '@/components/pdf-frame';
import { Button, ErrorText, OverflowMenu, Screen } from '@/components/ui';
import { repo } from '@/data/index';
import { PDF_OPEN_ERROR, loadPdfHtml, readPdfBytes } from '@/lib/pdfDocument';
import { writeCachedDocument } from '@/lib/pdfCacheFiles';
import { sharePdfBytes } from '@/lib/sharePdf';
import { pdfFileName } from '@/lib/pdfCache';
import { radius, space, textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

export default function PdfScreen() {
  const params = useLocalSearchParams<{ documentId?: string | string[] }>();
  const documentId = Array.isArray(params.documentId) ? params.documentId[0] : params.documentId;
  const navigation = useNavigation();
  const [title, setTitle] = useState('PDF');
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<{ page: number; total: number } | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [shareError, setShareError] = useState('');
  const bytesRef = useRef<Uint8Array | null>(null);
  const shareName = useRef('document.pdf');

  const share = useCallback(async () => {
    const bytes = bytesRef.current;
    if (!bytes) return;
    setShareError('');
    try {
      await sharePdfBytes(shareName.current, bytes);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setShareError('Could not share the PDF.');
    }
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerRight: () =>
        canShare ? <OverflowMenu label="More" items={[{ label: 'Share / Save', onPress: () => void share() }]} /> : null,
    });
  }, [canShare, navigation, share, title]);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    setPage(null);
    setCanShare(false);
    setShareError('');
    bytesRef.current = null;
    void (async () => {
      try {
        if (!documentId) throw new Error(PDF_OPEN_ERROR);
        const detail = await repo.getSiteDocument(documentId);
        if (!detail) throw new Error(PDF_OPEN_ERROR);
        if (!cancelled) setTitle(detail.title);
        const url = await repo.siteDocumentUrl(detail.storage_path);
        const bytes = await readPdfBytes(url, detail.title);
        if (cancelled) return;
        bytesRef.current = bytes;
        shareName.current = pdfFileName(detail.title);
        try {
          await writeCachedDocument(detail.id, detail.version_id, bytes);
        } catch {
          // The viewer still draws from memory. Sign-out clears whatever was stored.
        }
        const next = await loadPdfHtml(bytes);
        if (cancelled) return;
        setHtml(next);
        setCanShare(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, documentId]);

  if (failed) {
    return (
      <Screen>
        <View testID="pdf-retry" style={{ gap: space.md }}>
          <Text style={textStyle.bodyStrong}>{PDF_OPEN_ERROR}</Text>
          <Button label="Try again" variant="secondary" minHeight={48} onPress={() => setAttempt((value) => value + 1)} />
        </View>
      </Screen>
    );
  }

  if (!html) {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.text} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        <PdfFrame
          html={html}
          onPage={(nextPage, total) => setPage({ page: nextPage, total })}
          onError={() => setFailed(true)}
        />
        {page ? (
          <View
            testID="pdf-pages"
            pointerEvents="none"
            style={{
              position: 'absolute',
              bottom: space.lg,
              alignSelf: 'center',
              backgroundColor: theme.surface,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: theme.line,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
            }}>
            <Text accessibilityLabel={`Page ${page.page} of ${page.total}`} style={[textStyle.metaStrong, textStyle.tabular]}>
              {page.page} / {page.total}
            </Text>
          </View>
        ) : null}
        <ErrorText>{shareError}</ErrorText>
      </View>
    </Screen>
  );
}
