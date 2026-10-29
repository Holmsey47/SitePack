import { Button, ChoiceChip, ErrorText, Field, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { SITE_DOCUMENT_KINDS, siteDocumentBytesError, siteDocumentPickError, type SiteDocumentKind } from '@/data/siteDocuments';
import { textStyle } from '@/lib/theme';
import { readPickedBytes } from '@/lib/uploadBytes';
import { Text } from '@/src/theme/text';
import * as DocumentPicker from 'expo-document-picker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

export default function NewSiteDocumentScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<SiteDocumentKind>('induction');
  const [fileName, setFileName] = useState('');
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (person && person.role !== 'owner') return <Redirect href={`/sites/${siteId}/documents`} />;

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

  async function onSave() {
    if (!siteId || !person || !bytes || !title.trim()) return;
    setLoading(true);
    setError('');
    try {
      const created = await repo.createSiteDocument({
        siteId,
        companyId: person.company_id,
        createdBy: person.id,
        title: title.trim(),
        kind,
        fileName: fileName || 'document.pdf',
        bytes,
      });
      router.replace(`/sites/${siteId}/documents/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the document.');
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="sentences" maxLength={120} />
      <Text style={textStyle.metaStrong}>Type</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SITE_DOCUMENT_KINDS.map((item) => (
          <ChoiceChip
            key={item.kind}
            label={item.label}
            selected={kind === item.kind}
            onPress={() => setKind(item.kind)}
          />
        ))}
      </View>
      <Button label={fileName || 'Choose PDF'} variant="secondary" minHeight={48} onPress={() => void pickPdf()} />
      <ErrorText>{error}</ErrorText>
      <Button
        label="Upload"
        minHeight={48}
        loading={loading}
        disabled={!title.trim() || !bytes}
        onPress={() => void onSave()}
      />
    </Screen>
  );
}
