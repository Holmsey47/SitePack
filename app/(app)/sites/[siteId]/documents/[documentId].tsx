import { Button, Card, ErrorText, Muted, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import {
  memberMustSign,
  signRoster,
  siteDocumentBytesError,
  siteDocumentKindLabel,
  siteDocumentPickError,
  siteDocumentSignLabel,
  type SiteDocumentDetail,
} from '@/data/siteDocuments';
import { formatSignedWhen, formatUkDateTime } from '@/lib/format';
import { space, textStyle, theme } from '@/lib/theme';
import { readPickedBytes } from '@/lib/uploadBytes';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';

export default function SiteDocumentScreen() {
  const { siteId, documentId } = useLocalSearchParams<{ siteId: string; documentId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const [detail, setDetail] = useState<SiteDocumentDetail | null>(null);
  const [roster, setRoster] = useState<{ person_id: string; name: string; signed_at: string | null }[]>([]);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState('');
  const [fileName, setFileName] = useState('');
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const archiveConfirm = confirmDelete && (detail?.signatures.length ?? 0) > 0;

  useEffect(() => {
    if (!archiveConfirm) return;
    const scroll = () => {
      scrollRef.current?.scrollToEnd({ animated: true });
      if (Platform.OS === 'web') {
        document.querySelector('[data-testid="archive-confirm"]')?.scrollIntoView({ block: 'end', behavior: 'auto' });
      }
    };
    const frame = requestAnimationFrame(scroll);
    const timer = setTimeout(scroll, 100);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [archiveConfirm]);
  const owner = person?.role === 'owner';
  const mustSign = memberMustSign(person?.role);

  const load = useCallback(async () => {
    if (!documentId || !siteId) return;
    const next = await repo.getSiteDocument(documentId);
    setDetail(next);
    if (next && person?.role === 'owner') {
      const assigned = await repo.listAssignments(siteId);
      setRoster(signRoster(assigned, next.signatures));
    } else {
      setRoster([]);
    }
    setError('');
  }, [documentId, person?.role, siteId]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: detail?.title || 'Document' });
  }, [detail?.title, navigation]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load the document.'));
    }, [load]),
  );

  async function openPdf() {
    if (!detail) return;
    setError('');
    try {
      const url = await repo.siteDocumentUrl(detail.storage_path);
      if (url.startsWith('fixture:')) {
        setOpened('PDF ready on this phone.');
        return;
      }
      await WebBrowser.openBrowserAsync(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the PDF.');
    }
  }

  async function sign() {
    if (!detail || !person || !siteId) return;
    setBusy(true);
    setError('');
    try {
      await repo.signSiteDocument({
        documentId: detail.id,
        versionId: detail.version_id,
        siteId,
        personId: person.id,
        signerName: person.display_name?.trim() || 'Unknown',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the signature.');
    } finally {
      setBusy(false);
    }
  }

  async function pickPdf() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      base64: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const picked = siteDocumentPickError({ name: asset.name, mimeType: asset.mimeType, size: asset.size });
    if (picked) {
      setBytes(null);
      setFileName('');
      setError(picked);
      return;
    }
    try {
      const next = await readPickedBytes(asset, Platform.OS);
      const bytesError = siteDocumentBytesError(next);
      if (bytesError) {
        setBytes(null);
        setFileName('');
        setError(bytesError);
        return;
      }
      setBytes(next);
      setFileName(asset.name);
      setError('');
    } catch (err) {
      setBytes(null);
      setError(err instanceof Error ? err.message : 'Could not read that PDF.');
    }
  }

  async function saveVersion() {
    if (!detail || !person || !bytes) return;
    setBusy(true);
    setError('');
    try {
      await repo.replaceSiteDocument({
        documentId: detail.id,
        createdBy: person.id,
        fileName: fileName || 'document.pdf',
        bytes,
      });
      setBytes(null);
      setFileName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the new version.');
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      await repo.archiveSiteDocument(detail.id);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive the document.');
      setBusy(false);
    }
  }

  async function remove() {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      await repo.deleteSiteDocument(detail.id);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the document.');
      setBusy(false);
    }
  }

  if (!detail && !error) {
    return (
      <Screen>
        <Muted>Loading document…</Muted>
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const signedAt = detail.signatures.find((row) => row.person_id === person?.id)?.signed_at;
  const signedWhen = formatSignedWhen(signedAt);

  return (
    <Screen scrollRef={scrollRef}>
      <Text style={textStyle.bodyStrong}>{siteDocumentKindLabel(detail.kind)}</Text>
      <Text style={textStyle.metaStrong}>Version {detail.version_no}</Text>
      {detail.archived_at ? <Text style={{ ...textStyle.metaStrong, color: theme.muted }}>Archived</Text> : null}
      <Button label="Open PDF" variant="secondary" minHeight={48} onPress={() => void openPdf()} />
      {opened ? <Text style={{ ...textStyle.body }}>{opened}</Text> : null}
      {mustSign && !detail.archived_at && !detail.signed_by_me ? (
        <Button label={siteDocumentSignLabel(detail.kind)} minHeight={56} loading={busy} onPress={() => void sign()} />
      ) : null}
      {mustSign && !detail.archived_at && detail.signed_by_me ? (
        <Text style={{ ...textStyle.bodyStrong, color: theme.sent }}>
          {signedWhen ? `Signed ${signedWhen}` : 'Signed'}
        </Text>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {owner ? (
        <>
          <Text style={{ ...textStyle.bodyStrong }}>Who has signed</Text>
          {roster.length === 0 ? <Muted>Nobody assigned to sign.</Muted> : null}
          {roster.map((row) => (
            <Card key={row.person_id}>
              <Text style={{ ...textStyle.bodyStrong }}>{row.name}</Text>
              <Text style={{ ...textStyle.bodyStrong, color: row.signed_at ? theme.sent : theme.danger }}>
                {row.signed_at ? `Signed ${formatUkDateTime(row.signed_at)}` : 'Not signed'}
              </Text>
            </Card>
          ))}
          {detail.archived_at ? null : (
            <>
              <Button label={fileName || 'Choose a new PDF'} variant="secondary" minHeight={48} onPress={() => void pickPdf()} />
              {bytes ? (
                <Button label="Save new version" variant="secondary" minHeight={48} loading={busy} onPress={() => void saveVersion()} />
              ) : null}
              <View testID="archive-confirm" style={{ marginTop: space.xl, paddingTop: space.xl, borderTopWidth: 1, borderTopColor: theme.line, gap: space.md }}>
                {confirmDelete ? (
                  <Text style={textStyle.body}>
                    {detail.signatures.length > 0 ? `Archive ${detail.title}?` : `Delete ${detail.title}?`}
                  </Text>
                ) : null}
                {detail.signatures.length > 0 ? (
                  confirmDelete ? (
                    <Button label="Archive this document" variant="danger" minHeight={48} loading={busy} onPress={() => void archive()} />
                  ) : (
                    <Button label="Archive document" variant="ghost" minHeight={48} onPress={() => setConfirmDelete(true)} />
                  )
                ) : confirmDelete ? (
                  <Button label="Delete this document" variant="danger" minHeight={48} loading={busy} onPress={() => void remove()} />
                ) : (
                  <Button label="Delete document" variant="ghost" minHeight={48} onPress={() => setConfirmDelete(true)} />
                )}
              </View>
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
