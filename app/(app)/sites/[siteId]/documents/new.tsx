import { Button, ChoiceChip, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { SITE_DOCUMENT_KINDS, type SiteDocumentKind } from '@/data/siteDocuments';
import { theme } from '@/lib/theme';
import { readPickedBytes } from '@/lib/uploadBytes';
import * as DocumentPicker from 'expo-document-picker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';

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
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    try {
      setBytes(await readPickedBytes(asset, Platform.OS));
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
      <Title>Upload document</Title>
      <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="sentences" maxLength={120} />
      <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>Type</Text>
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
