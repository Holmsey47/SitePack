import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { talkError } from '@/data/talks';
import * as DocumentPicker from 'expo-document-picker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

export default function ReviseTalkScreen() {
  const { siteId, talkId } = useLocalSearchParams<{ siteId: string; talkId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [hasPdf, setHasPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<Uint8Array | null>(null);
  const [pdfName, setPdfName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!talkId) return;
    repo
      .getTalk(talkId)
      .then((talk) => {
        if (!talk) return;
        setTitle(talk.title);
        setBody(talk.body);
        setHasPdf(Boolean(talk.pdf_path));
        setPdfUrl(talk.pdf_url);
      })
      .catch(() => setError('Could not load the talk.'));
  }, [talkId]);

  if (person && !canManageSite(person.role)) return <Redirect href={`/sites/${siteId}/talks`} />;

  async function pickPdf() {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPdfName(asset.name);
    if (asset.file) {
      setReplacement(new Uint8Array(await asset.file.arrayBuffer()));
      return;
    }
    if (asset.uri) {
      const response = await fetch(asset.uri);
      setReplacement(new Uint8Array(await response.arrayBuffer()));
    }
  }

  async function bytesForSave(): Promise<Uint8Array | null> {
    if (replacement) return replacement;
    if (!hasPdf) return null;
    if (!pdfUrl) throw new Error('pdf_required');
    const response = await fetch(pdfUrl);
    if (!response.ok) throw new Error('pdf_required');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 1) throw new Error('pdf_required');
    return bytes;
  }

  async function onSave() {
    if (!talkId || !siteId || !person) return;
    setSaving(true);
    setError('');
    let uploadedPath: string | null = null;
    try {
      const bytes = await bytesForSave();
      let pdfPath: string | null = null;
      if (bytes) {
        const uploaded = await repo.uploadTalkPdf({ companyId: person.company_id, siteId, bytes });
        uploadedPath = uploaded.storagePath;
        pdfPath = uploaded.storagePath;
      }
      await repo.reviseTalk(talkId, { title, body, pdfPath });
      router.back();
    } catch (err) {
      if (uploadedPath) {
        try {
          await repo.removeTalkPdf(uploadedPath);
        } catch {
          // The revise already failed. Dropping the unused file is best-effort.
        }
      }
      setError(talkError(err instanceof Error ? err.message : 'unknown'));
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Title>New version</Title>
      {hasPdf ? (
        <Muted>
          Saving uploads the current PDF again as a new file, so the signed copy stays locked. Attach a different file only if the PDF itself has changed.
        </Muted>
      ) : null}
      <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="sentences" />
      <Field label="What it says" value={body} onChangeText={setBody} multiline autoCapitalize="sentences" />
      {hasPdf ? (
        <Button
          label={pdfName ? `Replacement PDF · ${pdfName}` : 'Replace the PDF'}
          variant="secondary"
          minHeight={56}
          onPress={() => void pickPdf()}
        />
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label="Save new version" minHeight={56} loading={saving} onPress={() => void onSave()} />
    </Screen>
  );
}
